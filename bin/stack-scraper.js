#!/bin/sh

"use strict";

const path = require("path");

const fs = require("graceful-fs");
const async = require("async");

const StackScraper = require("./src/stack-scraper.js");

// Bury broken connection errors coming from Spooky/Casper/Phantom
process.on("uncaughtException", err => {
    console.error("ERROR", err);
    console.error(err.stack);
});

const {ArgumentParser} = require("argparse");

const pkg = require("./package");

const argparser = new ArgumentParser({
    description: pkg.description,
    version: pkg.version,
    addHelp: true,
});

argparser.addArgument(
    ["type"],
    {
        help: "Type of scraper to load (e.g. 'images' or 'artists').",
    }
);

argparser.addArgument(
    ["source"],
    {
        help: "The name of the source to download (e.g. 'ndl' or '*').",
    }
);

argparser.addArgument(
    ["--scrape"],
    {
        action: "storeTrue",
        help: "Scrape and process the results from the " +
            "already-downloaded pages.",
    }
);

argparser.addArgument(
    ["--process"],
    {
        action: "storeTrue",
        help: "Process the results from the already-downloaded pages.",
    }
);

argparser.addArgument(
    ["--reset"],
    {
        action: "storeTrue",
        help: "Don't resume from where the last scrape left off.",
    }
);

argparser.addArgument(
    ["--delete"],
    {
        action: "storeTrue",
        help: "Delete all the data associated with the particular source.",
    }
);

argparser.addArgument(
    ["--debug"],
    {
        action: "storeTrue",
        help: "Output additional debugging information.",
    }
);

argparser.addArgument(
    ["--test-url"],
    {
        help: "Test extraction against a specified URL.",
        dest: "testURL",
    }
);

argparser.addArgument(
    ["--test"],
    {
        action: "storeTrue",
        help: "Test scraping and extraction of a source.",
    }
);

const args = argparser.parseArgs();

const stackScraper = new StackScraper();
let options = Object.assign({}, args);
options = Object.assign(options, genOptions(options, stackScraper));

const scrapeSource = function(source, callback) {
    console.log("Scraping:", source);
    const scrapeOptions = Object.assign({}, options);
    scrapeOptions.source = source;
    stackScraper.init(scrapeOptions);
    stackScraper.run(scrapeOptions, callback);
};

const done = () => console.log("DONE");

if (options.scrapersDir && args.source === "all") {
    const typeDir = path.resolve(options.scrapersDir, args.type);
    fs.readdir(typeDir, (err, sources) => {
        sources = sources.map(source => /([^\/]+).js$/.exec(source)[1]);
        async.eachLimit(sources, 1, scrapeSource, done);
    });
} else {
    scrapeSource(args.source, done);
}

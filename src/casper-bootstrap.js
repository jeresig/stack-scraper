if (typeof casper === "undefined") {
    console.log("This script must be run using `casperjs`.");
    if (typeof process !== "undefined") {
        process.exit(0);
    }
}

var fs = require("fs");

var resolve = function(path) {
    return fs.absolute(fs.workingDirectory + "/" + path);
};

var utils = require(resolve("./crawl.js"))(casper);

// Load in the scraper file
if (options.debug) {
    console.log("Loading: " + options.scraperFile);
}

var scraper = require(options.scraperFile)(casper);

utils.init(scraper, options);

if (options.debug) {
    console.log("Loaded.");
}
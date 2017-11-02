'use strict';
if (typeof casper === "undefined") {
    console.log("This script must be run using `casperjs`.");
    if (typeof process !== "undefined") {
        process.exit(0);
    }
}

const utils = require(`${options.dirname}/src/crawl.js`)(casper);

// Load in the scraper file
if (options.debug) {
    console.log(`Loading: ${options.scraperFile}`);
}

const scraper = require(options.scraperFile)(options, casper);

utils.init(scraper, options);

if (options.debug) {
    console.log("Loaded.");
}

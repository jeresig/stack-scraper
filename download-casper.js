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

var utils = require(resolve("./scrape-util.js"))(casper);

// Load in the scraper file
var scraperFile = resolve("../scrape/scrapers/" +
    options.type + "/" + options.site + ".js");

if (options.debug) {
    console.log("Loading: " + scraperFile);
}

var scraper = require(scraperFile)(casper);

utils.init(scraper, options);

if (options.debug) {
    console.log("Loaded.");
}
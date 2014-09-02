var mongoose = require("mongoose");

// Import models
require("./models");

require("../stack-scraper").cli(function(args, stackScraper) {
    return {
        rootDataDir: __dirname + "/data/",
        scrapersDir: __dirname + "/scrapers/",
        model: mongoose.model(args.type),
        logModel: mongoose.model("ScrapeLog"),
        postProcessors: require("./processing/" + args.type)(
            stackScraper)
    };
}, function(err) {
    if (err) {
        console.error(err);
    } else {
        console.log("DONE");
    }
    process.exit(0);
});
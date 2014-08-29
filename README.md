# Stack Scraper

Stack Scraper is a system for efficiently scraping information from complex web sites in a repeatable way, exporting directly to a data store.

Stack Scraper is good at collecting lots of semi-structured data from complicated, or even poorly-written, web sites in a repeatable manner.

## Features

* Scraping operations can be paused and resumed at a later time.
* Fault tolerant.
* Easy to scrape complex web sites, even ones with forms, pop-ups, JavaScript-based UIs, or other complexities.
* No one-to-one relationship between URLs and data collected. Multiple sources of data can be collected from a single page and the ID of the data can be handled arbitrarily (for example, the ID for a page could actually be the name of an image on the page, or the MD5 of that image, or something else entirely).
* Data for a single record can be collected, and compiled, from multiple, consecutive web pages. For example, let's say some data is on a page and then more data is within a popup. Both of those pages can be scraped and be combined into a single record.

## Usage

    var mongoose = require("mongoose");
    
    require("stack-scraper").cli(function(args, stackScraper) {
        return {
            rootDataDir: __dirname + "/data/",
            scrapersDir: __dirname + "/scrapers/",
            model: mongoose.model(args.type),
            logModel: mongoose.model("scrapelog"),
            postProcessors: require("./processing/" + args.type)(
                stackScraper),
            directories: {
                imagesDir: "./images/",
                thumbsDir: "./thumbs/",
                scaledDir: "./scaled/"
            }
        };
    }, function(err) {
        if (err) {
            console.error(err);
        } else {
            console.log("DONE");
        }
        process.exit(0);
    });

## Command-line Interface

**Arguments:**

* `type`: Type of scraper to load (e.g. 'images' or 'artists').
* `source`: The name of the source to download (e.g. 'ndl' or '*').

**Options:**

* `--scrape`: Scrape and process the results from the already-downloaded pages.
* `--process`: Process the results from the already-downloaded pages.
* `--reset`: Don't resume from where the last scrape left off.
* `--delete`: Delete all the data associated with the particular source.
* `--debug`: Output additional debugging information.
* `--test`: Test scraping and extraction of a source.
* `--test-url`: Test extraction against a specified URL.

**Initialization Properties:**

* `rootDataDir` (String): A full path to the root directory where downloaded data is stored. (See "File System" for more information.)
* `scrapersDir` (String): A full path to the directory where scraper `.js` files are stored. (See "Scrapers" for more information.)
* `directories` (Object<String>, optional): A key-value set of names of directories paired with the relative path to the directory. These directories will be created inside the individual source directory inside the `rootDataDir`. (See "File System" for more information.)
* `model` (Function): A function representing the model in which extracted data will be stored. (See "Datastore and Data Models" for more information.)
* `logModel` (Function): A function representing the log model for storing information about an in-progress site scrape. (See "Datastore and Data Models" for more information.)
* `postProcessors` (Object, optional): An object whose keys are the names of model properties which should be processed and values are functions through which the data will be processed. (See "Post-Processors" for more information.)

## Requirements

### Scrapers

### File System

### Datastore and Data Models

MongoDB + Mongoose

    dbFind(filter:Object, callback)
    dbFindById(id:String, callback)
    dbSave(data:Object, callback)
    dbUpdate(data:Object, newData:Object, callback)
    dbRemove(filter:Object, callback)
    dbLog(data:Object, callback)
    dbStreamLog(filter:Object) -> Stream
    dbRemoveLog(filter:Object, callback)

A sample Mongoose schema:

    var SampleSchema = mongoose.schema({
        // UUID of the data (Recommended format: SOURCE/UUID)
        _id: String,

        // The date that this item was created
        created: {type: Date, "default": Date.now},

        // The date that this item was updated
        modified: Date,

        // The source of the information (the name of the scraper)
        source: String,

        // UUID of the source page. (Format: PAGEMD5)
        pageID: String,

        // Full URL of the original page from where the data came
        url: String,

        // An array of page IDs from which data was extracted
        extract: [String],

        // Determine if data was actually extracted from the page
        extracted: Boolean
    });

### Post-Processors
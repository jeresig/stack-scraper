# Stack Scraper

Stack Scraper is a system for efficiently scraping information from complex web sites in a repeatable way, exporting directly to a data store.

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

Data model properties:

    /* Model Props:
     * - source
     * - extracted
     * - extract
     * - pageID
     * - modified
     * - created
     */

### Post-Processors
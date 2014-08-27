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

```
/* Model Props:
 * - source
 * - extracted
 * - extract
 * - pageID
 * - modified
 * - created
 */

/* Options:
 * - source *
 * - model *
 * - postProcessors
 * - pageSettings
 * - mirrorExclude
 * - scraperFile *
 * - htmlDir
 * - xmlDir
 * - sourceName
 * - debug
 */
```

## Requirements


### Datastore

MongoDB + Mongoose

    dbFind(filter:Object, callback)
    dbFindById(id:String, callback)
    dbSave(data:Object, callback)
    dbUpdate(data:Object, newData:Object, callback)
    dbRemove(filter:Object, callback)
    dbLog(data:Object, callback)
    dbStreamLog(filter:Object) -> Stream
    dbRemoveLog(filter:Object, callback)
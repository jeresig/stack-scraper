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

```
usage: [-h] [-v] [--scrape] [--process] [--update] [--delete]
       [--debug]
       type source

Stack Scraper. Easily download complex web sites.

Positional arguments:
  type           Type of scraper to load (e.g. 'images' or 'artists').
  source         The name of the source to download (e.g. 'ndl' or '*').

Optional arguments:
  -h, --help     Show this help message and exit.
  -v, --version  Show program's version number and exit.
  --scrape       Scrape and process the results from the already-downloaded
                 pages.
  --process      Process the results from the already-downloaded pages.
  --update       Force the existing entries to be updated rather than deleted
                 first.
  --delete       Delete all the data associated with the particular source.
  --debug        Output additional debugging information.
```

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
# Stack Scraper

Stack Scraper is a system for efficiently scraping information from complex web sites in a repeatable way, exporting directly to a data store.

Stack Scraper is good at collecting lots of semi-structured data from complicated, or even poorly-written, web sites in a repeatable manner.

Features
========

* Scraping operations can be paused and resumed at a later time.
* Fault tolerant.
* Easy to scrape complex web sites, even ones with forms, pop-ups, JavaScript-based UIs, or other complexities.
* No one-to-one relationship between URLs and data collected. Multiple sources of data can be collected from a single page and the ID of the data can be handled arbitrarily (for example, the ID for a page could actually be the name of an image on the page, or the MD5 of that image, or something else entirely).
* Data for a single record can be collected, and compiled, from multiple, consecutive web pages. For example, let's say some data is on a page and then more data is within a popup. Both of those pages can be scraped and be combined into a single record.
* The process for crawling, downloading, extracting data, and processing the data are all de-coupled. They can all be run back-to-back, or one-at-a-time, or even repeatedly.

Guide
=====

*See the `example` directory for a full sample scraper.*

Stack Scraper provides the code to write a simple command-line application for downloading semi-structured data from complex web sites. However you'll need to take a number of things into consideration when you're building your `stack-scraper` implementation, namely:

* **Command-line Interface** The implementation of the command-line utilty and where various utility files will be located.
* **Scrapers** An implementation of a basic scraper.
* **File System** Where downloaded files (html, images, etc.) will live.
* **Datastore and Data Models** Where extracted data and scrape logs will be stored, and how.
* **Post-Processors** If any post-processing on the extracted data will be completed and how to do it.

### Command-line Interface

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

### Post-Processors
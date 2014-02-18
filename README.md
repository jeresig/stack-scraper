
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
/**
 * Last-Modified example
 *
 * Run with `node example-lastmodified.js`. This example shows how fetching a
 * resource and setting the If-Modified-Since request header returns a 304 when
 * resource has not been modified.
 */
const fetch = require('../');

fetch.setParameter('logToConsole', true);

async function run() {
  const lastModified = 'Mon, 02 Oct 2017 10:45:14 GMT';
  console.log(`Fetch https://www.w3.org/TR/2012/REC-hr-time-20121217/ with last modified date ${lastModified}`);
  let resp = await fetch('https://www.w3.org/TR/2012/REC-hr-time-20121217/', {
    refresh: 'once',
    headers: {
      'If-Modified-Since': lastModified
    }
  });
  console.log(`Received HTTP status ${resp.status} with last-modified header ${resp.headers.get('last-modified')}`)

  console.log();
  console.log(`Put https://www.w3.org/TR/2012/REC-hr-time-20121217/ in file cache if needed`);
  resp = await fetch('https://www.w3.org/TR/2012/REC-hr-time-20121217/', {
    refresh: 'force'
  });
  console.log(`Received HTTP status ${resp.status} with last-modified header ${resp.headers.get('last-modified')}`)

  console.log();
  console.log(`Fetch https://www.w3.org/TR/2012/REC-hr-time-20121217/ from file cache with last modified date ${lastModified}`);
  resp = await fetch('https://www.w3.org/TR/2012/REC-hr-time-20121217/', {
    refresh: 'never',
    headers: {
      'If-Modified-Since': lastModified
    }
  });
  console.log(`Received HTTP status ${resp.status} with last-modified header ${resp.headers.get('last-modified')}`)
}

run().catch(err => console.error(err));
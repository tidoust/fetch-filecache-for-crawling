/**
 * Etag example
 *
 * Run with `node example-etag.js`. This example shows how fetching a resource
 * and setting the If-None-Match request header returns a 304 when resource has
 * not been modified.
 */
const fetch = require('../');

fetch.setParameter('logToConsole', true);

async function run() {
  const etag = '"5421-55a8e11cc2280"';
  console.log(`Fetch https://www.w3.org/TR/2012/REC-hr-time-20121217/ with etag ${etag}`);
  let resp = await fetch('https://www.w3.org/TR/2012/REC-hr-time-20121217/', {
    refresh: 'once', // Needed because of invalid cache semantics in W3C servers
    compress: false,
    headers: {
      'If-None-Match': etag
    }
  });
  console.log(`Received HTTP status ${resp.status} with etag ${resp.headers.get('etag')}`)

  console.log();
  console.log(`Put https://www.w3.org/TR/2012/REC-hr-time-20121217/ in file cache if needed`);
  resp = await fetch('https://www.w3.org/TR/2012/REC-hr-time-20121217/', {
    refresh: 'force',
    compress: false,
  });
  console.log(`Received HTTP status ${resp.status} with etag ${resp.headers.get('etag')}`)

  console.log();
  console.log(`Fetch https://www.w3.org/TR/2012/REC-hr-time-20121217/ from file cache with etag ${etag}`);
  resp = await fetch('https://www.w3.org/TR/2012/REC-hr-time-20121217/', {
    refresh: 'never',
    headers: {
      'If-None-Match': etag
    }
  });
  console.log(`Received HTTP status ${resp.status} with etag ${resp.headers.get('etag')}`)
}

run().catch(err => console.error(err));

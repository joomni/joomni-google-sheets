/**
 * A small Joomni REST API client for Apps Script (UrlFetchApp).
 * Retries 429 and 5xx with backoff, honouring Retry-After.
 */

var DEFAULT_BASE_URL = 'https://api.joomni.com/api/v1';
var MAX_RETRIES = 3;

function JoomniApiError_(status, message) {
  this.name = 'JoomniApiError';
  this.status = status;
  this.message = 'Joomni API ' + status + ': ' + message;
}
JoomniApiError_.prototype = Object.create(Error.prototype);

/**
 * GET a path such as '/orders' with a query object.
 * Uses the saved connection unless `connection` ({ apiKey, baseUrl }) is given.
 */
function joomniGet_(path, query, connection) {
  var conn = connection || getConnection_();
  if (!conn) throw new Error('Not connected. Use Joomni › Connect store first.');

  var qs = Object.keys(query || {})
    .filter(function (k) { return query[k] !== undefined && query[k] !== null && query[k] !== ''; })
    .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(String(query[k])); })
    .join('&');
  var url = conn.baseUrl.replace(/\/+$/, '') + path + (qs ? '?' + qs : '');

  for (var attempt = 0; ; attempt++) {
    var res = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + conn.apiKey, Accept: 'application/json' },
      muteHttpExceptions: true,
      followRedirects: true,
    });
    var status = res.getResponseCode();
    var text = res.getContentText();
    var body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch (e) {
      body = { message: text };
    }
    if (status >= 200 && status < 300) return body;

    var retryable = status === 429 || status >= 500;
    if (!retryable || attempt >= MAX_RETRIES) {
      var detail = body && body.message ? (Array.isArray(body.message) ? body.message.join('; ') : body.message) : 'request failed';
      throw new JoomniApiError_(status, detail);
    }
    var headers = res.getHeaders();
    var retryAfter = Number(headers['Retry-After'] || headers['retry-after']);
    Utilities.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * Math.pow(2, attempt));
  }
}

/**
 * TALKING TO THE TWO CATALOGUES
 * -----------------------------
 * Both of them are public and neither needs an account or a key, but they
 * differ in one awkward way: Apple sends the header that lets a browser read
 * its answer directly, and Deezer does not.
 *
 * So Deezer is asked the old way, JSONP: the answer comes back as a piece of
 * JavaScript that calls a function we named, loaded through a script tag,
 * which the browser does not police the same way it polices fetch.
 *
 * Nothing about your photo or your project is ever sent to either of them.
 * Only the words you type into the search box leave this device.
 */

/** How long to wait before giving up on either catalogue. */
const TIMEOUT = 12000;

export function jsonp(url) {
  return new Promise((resolve, reject) => {
    const name = `npCallback${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');

    const cleanup = () => {
      delete window[name];
      script.remove();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('The search timed out.'));
    }, TIMEOUT);

    window[name] = data => {
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };
    script.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error('The search could not be reached.'));
    };

    script.src = url + (url.includes('?') ? '&' : '?') + `callback=${name}`;
    document.head.appendChild(script);
  });
}

/** Fetch as JSON, falling back to JSONP if the browser blocks the read. */
export async function getJson(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Search returned ${response.status}`);
    return await response.json();
  } catch (error) {
    if (!navigator.onLine) throw new Error('offline');
    return jsonp(url);
  }
}

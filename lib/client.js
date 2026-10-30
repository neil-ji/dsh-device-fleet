/**
 * Controller-side HTTP client for one worker device.
 *
 * Thin, dependency-free: every call is one fetch with a bounded timeout and a
 * Bearer token, returning plain JSON the tools can hand to the model.
 *
 * @module dsh-device-fleet/client
 */

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Perform one authenticated JSON call against a worker.
 * @param {object} worker Worker endpoint config.
 * @param {string} worker.name Display name used in errors.
 * @param {string} worker.url Base URL, for example `http://192.168.1.74:8791`.
 * @param {string} [worker.token] Bearer token.
 * @param {string} method HTTP method.
 * @param {string} path Path beginning with `/fleet/`.
 * @param {unknown} [body] JSON body for POST.
 * @param {number} [timeoutMs] Per-call timeout.
 * @returns {Promise<unknown>} Parsed response body.
 */
export async function callWorker(worker, method, path, body, timeoutMs = DEFAULT_TIMEOUT_MS) {
	const base = worker.url.replace(/\/+$/, '');
	let response;
	try {
		response = await fetch(`${base}${path}`, {
			method,
			headers: {
				'content-type': 'application/json',
				...(worker.token ? { authorization: `Bearer ${worker.token}` } : {}),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
	} catch (error) {
		throw new Error(`worker ${worker.name} unreachable at ${base}: ${error instanceof Error ? error.message : String(error)}`);
	}
	const text = await response.text();
	let parsed = null;
	try {
		parsed = text === '' ? null : JSON.parse(text);
	} catch {
		parsed = { error: text.slice(0, 200) };
	}
	if (!response.ok) {
		const message = parsed && typeof parsed === 'object' && 'error' in parsed ? String(parsed.error) : response.statusText;
		throw new Error(`worker ${worker.name} ${method} ${path} -> ${response.status}: ${message}`);
	}
	return parsed;
}

/**
 * Probe one worker; resolves to a boolean instead of throwing so listing
 * several workers degrades gracefully.
 * @param {object} worker Worker endpoint config.
 * @returns {Promise<{ online: boolean, device?: string, error?: string }>} Reachability and identity.
 */
export async function pingWorker(worker) {
	try {
		const value = await callWorker(worker, 'GET', '/fleet/ping', undefined, 4_000);
		const info = /** @type {{ device?: string }} */ (value ?? {});
		return { online: true, device: info.device };
	} catch (error) {
		return { online: false, error: error instanceof Error ? error.message : String(error) };
	}
}

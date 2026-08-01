import { serverEnv } from '../env';

export type UpcLookupResult = { title: string };

type UpcItemDbResponse = {
	code: string;
	items?: { title: string }[];
};

/**
 * Resolves a UPC/EAN barcode to a product title via UPCitemdb.
 * Returns null when the barcode has no known product (an expected outcome,
 * not an error) so callers can fall back to manual title search.
 */
export async function lookupUpc(barcode: string): Promise<UpcLookupResult | null> {
	const apiKey = serverEnv.UPCITEMDB_API_KEY;
	const url = apiKey
		? `https://api.upcitemdb.com/prod/v1/lookup?upc=${encodeURIComponent(barcode)}`
		: `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(barcode)}`;

	const response = await fetch(url, {
		headers: apiKey ? { user_key: apiKey, key_type: '3scale' } : undefined
	});

	if (!response.ok) {
		throw new Error(`UPCitemdb request failed with status ${response.status}`);
	}

	const data = (await response.json()) as UpcItemDbResponse;
	const item = data.items?.[0];
	if (!item?.title) {
		return null;
	}

	return { title: item.title };
}

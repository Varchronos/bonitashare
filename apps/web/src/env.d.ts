declare namespace App {
	interface Locals {
		// Set by getSession (lib/session.ts): the cookie header carrying this render's session, renewed
		// token included, for any further API calls during the render.
		sessionCookie?: string;
		// Memo for currentAccount (lib/account.ts), so the page and the navbar share one lookup.
		account?: import('@bonitashare/shared-types').Account | null;
	}
}

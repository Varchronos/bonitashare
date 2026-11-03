import { useAsyncAction } from '../hooks/useAsyncAction';

async function logout(): Promise<void> {
	const res = await fetch('/api/v1/session', { method: 'DELETE' }).catch(() => null);
	if (!res?.ok) throw new Error("Couldn't log out. Try again.");
}

// The account page's log out button. The API clears the cookie, or puts back the anonymous session this
// browser had before logging in; the home page then starts from whichever it is.
export default function LogoutButton() {
	const action = useAsyncAction({
		triggerFn: logout,
		onSuccess: () => location.assign('/'),
	});

	return (
		<>
			<button type="button" className="btn btn-outlined" disabled={action.isPending} onClick={() => action.trigger()}>
				{action.isPending ? 'Logging out…' : 'Log out'}
			</button>
			{action.error && (
				<p role="alert" className="basis-full text-sm text-error">
					{action.error.message}
				</p>
			)}
		</>
	);
}

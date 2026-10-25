import { copyLink } from './TaskRow';
import whatsapp from '../../assets/whatsapp.png';
import telegram from '../../assets/telegram.png';
import discord from '../../assets/discord.png';

const button = 'icon-btn icon-btn-sm';

function Logo({ src }: { src: string }) {
	return <img src={src} alt="" width={20} height={20} className="size-5" />;
}

// For apps without a share URL that works here: copies the link and opens the app to paste it in.
function copyAndOpen(link: string, appUrl: string) {
	// Both started inside the click, neither awaited: the copy needs this page focused when it starts,
	// and a window opened after an await is no longer tied to the click, so popup blockers stop it.
	copyLink(link);
	window.open(appUrl, '_blank', 'noreferrer');
}

// Share a file's link to a chat app. WhatsApp takes the link in a share URL; Telegram and Discord copy
// it and open the app instead.
export default function ShareLinks({ link }: { link: string }) {
	const url = encodeURIComponent(link);

	return (
		<div className="flex shrink-0 items-center">
			<a
				href={`https://wa.me/?text=${url}`}
				target="_blank"
				rel="noreferrer"
				className={button}
				aria-label="Share on WhatsApp"
				title="Share on WhatsApp"
			>
				<Logo src={whatsapp.src} />
			</a>
			{/* <button
				type="button"
				className={button}
				aria-label="Copy link and open Telegram"
				title="Copy link and open Telegram"
				onClick={() => copyAndOpen(link, 'https://web.telegram.org/')}
			>
				<Logo src={telegram.src} />
			</button>
			<button
				type="button"
				className={button}
				aria-label="Copy link and open Discord"
				title="Copy link and open Discord"
				onClick={() => copyAndOpen(link, 'https://discord.com/app')}
			>
				<Logo src={discord.src} />
			</button> */}
		</div>
	);
}

import { useEffect, useState } from 'react';
import { photoUrl } from './data.js';

// A recipe's photo, fetched with the sign-in (and kept on the device).
export function Photo({ src, className }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setUrl(null);
    setFailed(false);
    if (src) photoUrl(src).then((u) => live && setUrl(u), () => live && setFailed(true));
    return () => { live = false; };
  }, [src]);
  return (
    <span className={`rec-photo ${className || ''}`}>
      {url ? <img src={url} alt="" /> : <span className="rec-photo-none">{src && !failed ? '' : '🍽️'}</span>}
    </span>
  );
}

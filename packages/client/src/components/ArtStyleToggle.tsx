import { useArtStyle } from '../lib/artStyle';

/** A small always-visible switch letting players flip between the default painted-fantasy art and the alternate anime-styled art. */
export function ArtStyleToggle() {
  const [style, toggle] = useArtStyle();
  return (
    <button type="button" className="art-style-toggle" onClick={toggle} title="Switch card/boss art style">
      <span className={style === 'classic' ? 'active' : ''}>Classic</span>
      <span className="art-style-switch" data-on={style === 'anime'}>
        <span className="knob" />
      </span>
      <span className={style === 'anime' ? 'active' : ''}>Anime</span>
    </button>
  );
}

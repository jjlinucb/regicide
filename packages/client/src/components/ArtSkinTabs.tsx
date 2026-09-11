import { type ArtSkin, useArtSkin } from '../artSkin';

const SKINS: { id: ArtSkin; name: string; description: string }[] = [
  { id: 'storybook', name: 'Storybook', description: 'Soft, colorful illustrated portraits' },
  { id: 'realms', name: 'Realms', description: 'Grounded human portraits in linen and wool' },
];

export function ArtSkinTabs() {
  const { skin, setSkin } = useArtSkin();

  return (
    <section className="art-skin-tabs" aria-label="Card art style">
      <div className="art-skin-tabs-copy">
        <span className="art-skin-tabs-label">Card art</span>
        <span className="art-skin-tabs-description">{SKINS.find((option) => option.id === skin)?.description}</span>
      </div>
      <div className="art-skin-tablist" role="tablist" aria-label="Choose card art">
        {SKINS.map((option) => (
          <button
            type="button"
            key={option.id}
            role="tab"
            aria-selected={skin === option.id}
            className={skin === option.id ? 'active' : ''}
            onClick={() => setSkin(option.id)}
          >
            {option.name}
          </button>
        ))}
      </div>
    </section>
  );
}

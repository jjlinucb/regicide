import { createContext, useContext, useEffect, useState, type PropsWithChildren } from 'react';

export type ArtSkin = 'storybook' | 'realms';

type ArtSkinContextValue = {
  skin: ArtSkin;
  setSkin: (skin: ArtSkin) => void;
};

const STORAGE_KEY = 'regicide-art-skin';
const ArtSkinContext = createContext<ArtSkinContextValue | null>(null);

function savedSkin(): ArtSkin {
  if (typeof window === 'undefined') return 'storybook';
  return window.localStorage.getItem(STORAGE_KEY) === 'realms' ? 'realms' : 'storybook';
}

export function ArtSkinProvider({ children }: PropsWithChildren) {
  const [skin, setSkin] = useState<ArtSkin>(savedSkin);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, skin);
  }, [skin]);

  return <ArtSkinContext.Provider value={{ skin, setSkin }}>{children}</ArtSkinContext.Provider>;
}

export function useArtSkin(): ArtSkinContextValue {
  const value = useContext(ArtSkinContext);
  if (!value) throw new Error('useArtSkin must be used inside ArtSkinProvider');
  return value;
}

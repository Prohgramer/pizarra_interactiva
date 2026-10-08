import { useCallback, useRef, useState } from 'react';

export interface Notice {
  /** Cambia en cada aviso, aunque el texto se repita. */
  id: number;
  text: string;
}

/** Un aviso breve a la vez (lo muestra <Toast>). */
export function useNotice() {
  const [notice, setNotice] = useState<Notice | null>(null);
  const countRef = useRef(0);

  const showNotice = useCallback((text: string) => {
    countRef.current += 1;
    setNotice({ id: countRef.current, text });
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { notice, showNotice, dismissNotice };
}

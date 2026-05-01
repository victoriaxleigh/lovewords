import { useEffect, useState } from 'react';
import { onAuthChange } from '../supabase/authService';

export function useAuth() {
  const [user, setUser] = useState<any | undefined>(undefined); // undefined = loading
  useEffect(() => {
    const unsub = onAuthChange(setUser);
    return unsub;
  }, []);
  return { user, loading: user === undefined };
}

import {create} from 'zustand';
import { persist } from 'zustand/middleware';

export const userStore = create(
    persist(
        (set) => ({
            user: null,
            setUser: (user) => set({ user }),
            clearUser: () => set({ user: null }),
        }),
        {
            name: 'user-store', // unique name for the storage key
        }
    ),
)

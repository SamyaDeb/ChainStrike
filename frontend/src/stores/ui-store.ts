import { create } from "zustand";

interface UIState {
  // Modals
  isWalletModalOpen: boolean;
  isSettingsModalOpen: boolean;
  
  // Sidebar
  isSidebarCollapsed: boolean;
  
  // Theme (always dark for cyberpunk)
  theme: "dark";
  
  // Mobile menu
  isMobileMenuOpen: boolean;
  
  // Toasts
  toasts: Toast[];
  
  // Actions
  openWalletModal: () => void;
  closeWalletModal: () => void;
  toggleWalletModal: () => void;
  
  openSettingsModal: () => void;
  closeSettingsModal: () => void;
  
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  
  toggleMobileMenu: () => void;
  closeMobileMenu: () => void;
  
  addToast: (toast: Omit<Toast, "id">) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  title: string;
  message?: string;
  duration?: number;
}

let toastId = 0;

export const useUIStore = create<UIState>((set) => ({
  isWalletModalOpen: false,
  isSettingsModalOpen: false,
  isSidebarCollapsed: false,
  theme: "dark",
  isMobileMenuOpen: false,
  toasts: [],

  openWalletModal: () => set({ isWalletModalOpen: true }),
  closeWalletModal: () => set({ isWalletModalOpen: false }),
  toggleWalletModal: () =>
    set((state) => ({ isWalletModalOpen: !state.isWalletModalOpen })),

  openSettingsModal: () => set({ isSettingsModalOpen: true }),
  closeSettingsModal: () => set({ isSettingsModalOpen: false }),

  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ isSidebarCollapsed: collapsed }),

  toggleMobileMenu: () =>
    set((state) => ({ isMobileMenuOpen: !state.isMobileMenuOpen })),
  closeMobileMenu: () => set({ isMobileMenuOpen: false }),

  addToast: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          ...toast,
          id: `toast-${++toastId}`,
          duration: toast.duration ?? 5000,
        },
      ],
    })),
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
  clearToasts: () => set({ toasts: [] }),
}));

// Helper function for quick toasts
export const toast = {
  success: (title: string, message?: string) =>
    useUIStore.getState().addToast({ type: "success", title, message }),
  error: (title: string, message?: string) =>
    useUIStore.getState().addToast({ type: "error", title, message }),
  warning: (title: string, message?: string) =>
    useUIStore.getState().addToast({ type: "warning", title, message }),
  info: (title: string, message?: string) =>
    useUIStore.getState().addToast({ type: "info", title, message }),
};

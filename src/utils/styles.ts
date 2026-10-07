// Shared design tokens — import instead of hardcoding values in each screen.
export const RADII = {
  sm: 8,    // small inline buttons (delete confirm, etc.)
  md: 12,   // primary buttons, text inputs
  lg: 14,   // game cards
  xl: 16,   // info panels / boxes
};

export const SHADOWS = {
  card: {
    shadowColor: '#000' as const,
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  btn: {
    shadowColor: '#E91E8C' as const,
    shadowOpacity: 0.4,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 6,
  },
};

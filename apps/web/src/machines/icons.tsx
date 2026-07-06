/**
 * The single source for machine icons — maps a catalog `icon` name to its
 * lucide node. Both the rail submenu tile and the on-canvas block render from
 * here, so a new machine's icon is declared in exactly one place.
 */

import { Grid2x2, LayoutGrid, Swords, Scale, ShieldAlert, CornerDownRight, UserRound } from 'lucide-react';

export const MACHINE_ICONS: Record<string, React.ReactNode> = {
  Grid2x2: <Grid2x2 size={16} />,
  LayoutGrid: <LayoutGrid size={16} />,
  Swords: <Swords size={16} />,
  Scale: <Scale size={16} />,
  ShieldAlert: <ShieldAlert size={16} />,
  CornerDownRight: <CornerDownRight size={16} />,
  UserRound: <UserRound size={16} />,
};

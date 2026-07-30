export type UserRole = "superadmin" | "lab_admin" | "lab_reader";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  labId: string | null;
};

export interface UserData {
  username: string;
  password: string;
  photoUrl: string | null; // data URL from FileReader, or null if no photo
  stars: number;
  level: number;
  completionRate: number;
}

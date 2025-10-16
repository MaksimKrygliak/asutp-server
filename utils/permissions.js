export const ALL_PERMISSIONS = [
  { name: "Screen_Home", label: "Екран Головна", group: "screens" },
  { name: "Screen_ScanQR", label: "Екран Сканувати QR", group: "screens" },
  { name: "Screen_GenerateQR", label: "Екран Генератор QR", group: "screens" },

  { name: "Screen_DocQR", label: "Екран Документація QR", group: "screens" },
  { name: "Screen_Doc", label: "Екран Документація", group: "screens" },
  { name: "Screen_Notes", label: "Екран Нотатки", group: "screens" },
  { name: "Screen_PhoneNumber", label: "Екран Телефонний довідник", group: "screens" },
  { name: "Screen_User", label: "Екран Співробітники", group: "screens" },
  { name: "Screen_Location", label: "Екран Локації", group: "screens" },
  { name: "Screen_Encryptedile", label: "Екран Шифрування файлів", group: "screens" },

  { name: "Download_doc_zip", label: "Завантаження документів", group: "functional" },
  { name: "Notes_Edit", label: "Редагувати нотатки", group: "functional" },
  { name: "Notes_Delete", label: "Видаляти нотатки", group: "functional" },
  { name: "DocQR_Edit", label: "Редагувати документи QR", group: "functional" },
  { name: "DocQR_Delete", label: "Видаляти документи QR", group: "functional" },
  { name: "Users_Edit", label: "Редагувати користувачів", group: "functional" },
  { name: "UsersPhoto_Edit", label: "Редагувати фото користувачів", group: "functional" },
  { name: "PhoneNumber_Edit", label: "Редагувати телефонний довідник", group: "functional" },
  { name: "PhoneNumber_Delete", label: "Видаляти телефонний довідник", group: "functional" },

  { name: "Locations_Edit", label: "Редагувати локації", group: "functional" },
  { name: "Locations_Delete", label: "Видаляти локації", group: "functional" },
];

export const PERMISSION_NAMES = ALL_PERMISSIONS.reduce((acc, perm) => {
  acc[perm.name] = perm.name;
  return acc;
}, {});

export const ROLE_PERMISSIONS = {
  адміністратор: ALL_PERMISSIONS.map((p) => p.name), 
  1: [
    PERMISSION_NAMES.Screen_Home,
  ],
  2: [
    PERMISSION_NAMES.Screen_Home,
    PERMISSION_NAMES.Screen_ScanQR,
    PERMISSION_NAMES.Screen_GenerateQR,
    PERMISSION_NAMES.Screen_DocQR,
    PERMISSION_NAMES.Screen_Doc,
    PERMISSION_NAMES.Screen_Notes,
    PERMISSION_NAMES.Screen_PhoneNumber,
    PERMISSION_NAMES.Screen_User,
    PERMISSION_NAMES.Screen_Location,

    PERMISSION_NAMES.Download_doc_zip,
  ],
  3: [
    PERMISSION_NAMES.Screen_Home,
    PERMISSION_NAMES.Screen_ScanQR,
    PERMISSION_NAMES.Screen_GenerateQR,
    PERMISSION_NAMES.Screen_DocQR,
    PERMISSION_NAMES.Screen_Doc,
    PERMISSION_NAMES.Screen_Notes,
    PERMISSION_NAMES.Screen_PhoneNumber,
    PERMISSION_NAMES.Screen_User,
    PERMISSION_NAMES.Screen_Location,

    PERMISSION_NAMES.Notes_Edit,
    PERMISSION_NAMES.Notes_Delete,
    PERMISSION_NAMES.DocQR_Edit,
    PERMISSION_NAMES.DocQR_Delete,
    PERMISSION_NAMES.Download_doc_zip,
    PERMISSION_NAMES.PhoneNumber_Edit,
    PERMISSION_NAMES.PhoneNumber_Delete,
    PERMISSION_NAMES.Locations_Edit,
    PERMISSION_NAMES.Locations_Delete,
  ],
};

export const ALL_ROLES = Object.keys(ROLE_PERMISSIONS);

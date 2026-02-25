export const ALL_PERMISSIONS = [
  { name: "Screen_Home", label: "Екран Головна", group: "screens" },
  { name: "Screen_ScanQR", label: "Екран Сканувати QR", group: "screens" },
  { name: "Screen_GenerateQR", label: "Екран Генератор QR", group: "screens" },

  { name: "Screen_Monitoring", label: "Екран Моніторінгу", group: "screens" },
  { name: "Screen_Instructions", label: "Екран Інструкцій", group: "screens" },
  { name: "Screen_DocQR", label: "Екран Документація QR", group: "screens" },
  { name: "Screen_Doc", label: "Екран Документація", group: "screens" },
  { name: "Screen_Notes", label: "Екран Нотатки", group: "screens" },
  { name: "Screen_PhoneNumber", label: "Екран Телефонний довідник", group: "screens" },
  { name: "Screen_User", label: "Екран Співробітники", group: "screens" },
  { name: "Screen_Location", label: "Екран Локацій", group: "screens" },
  { name: "Screen_Encryptedile", label: "Екран Шифрування файлів", group: "screens" },

  { name: "Download_doc_zip", label: "Завантаження документів", group: "functional" },
  { name: "Notes_Edit", label: "Редагувати нотатки", group: "functional" },
  { name: "Notes_Delete", label: "Видаляти нотатки", group: "functional" },
  { name: "DocQR_Edit", label: "Редагувати документи QR", group: "functional" },
  { name: "DocQR_Delete", label: "Видаляти документи QR", group: "functional" },
  { name: "Users_Edit", label: "Редагувати користувачів", group: "functional" },
  { name: "UsersPhoto_Edit", label: "Редагувати фото користувачів", group: "functional" },
  { name: "PhoneNumber_Edit", label: "Редагувати телефонний довідник", group: "functional" },
  { name: "PhoneNumber_Delete", label: "Видаляти телефони з довідника", group: "functional" },

  { name: "Locations_Edit", label: "Редагувати локації", group: "functional" },
  { name: "Locations_Delete", label: "Видаляти локації", group: "functional" },
  { name: "Premises_Edit", label: "Редагувати приміщення", group: "functional" },
  { name: "Premises_Delete", label: "Видаляти приміщення", group: "functional" },
  { name: "Enclosures_Edit", label: "Редагувати шафи", group: "functional" },
  { name: "Enclosures_Delete", label: "Видаляти шафи", group: "functional" },
  { name: "TerminalBlocks_Edit", label: "Редагувати клемні колодки", group: "functional" },
  { name: "TerminalBlocks_Delete", label: "Видаляти клемні колодки", group: "functional" },
  { name: "Signals_Edit", label: "Редагувати сигнали", group: "functional" },
  { name: "Signals_Delete", label: "Видаляти сигнали", group: "functional" },
  { name: "PC_Edit", label: "Редагувати ПК", group: "functional" },
  { name: "PC_Delete", label: "Видаляти ПК", group: "functional" },
  { name: "Servers_Edit", label: "Редагувати сервери", group: "functional" },
  { name: "Servers_Delete", label: "Видаляти сервери", group: "functional" },
  { name: "UPS_Edit", label: "Редагувати UPS", group: "functional" },
  { name: "UPS_Delete", label: "Видаляти UPS", group: "functional" },
  { name: "VirtualMachine_Edit", label: "Редагувати віртуальні машини", group: "functional" },
  { name: "VirtualMachine_Delete", label: "Видаляти віртуальні машини", group: "functional" },

  { name: "View_Login", label: "Переглядати логіни", group: "functional" },
  { name: "View_Password", label: "Переглядати паролі", group: "functional" },
];

export const PERMISSION_NAMES = ALL_PERMISSIONS.reduce((acc, perm) => {
  acc[perm.name] = perm.name;
  return acc;
}, {});

const level1Permissions = [
  PERMISSION_NAMES.Screen_Home,
];

const level2Permissions = [
  ...level1Permissions,
  PERMISSION_NAMES.Screen_Instructions,
  PERMISSION_NAMES.Screen_ScanQR,
  PERMISSION_NAMES.Screen_GenerateQR,
  PERMISSION_NAMES.Screen_DocQR,
  PERMISSION_NAMES.Screen_Doc,
  PERMISSION_NAMES.Screen_Notes,
  PERMISSION_NAMES.Screen_PhoneNumber,
  PERMISSION_NAMES.Screen_User,
  PERMISSION_NAMES.Screen_Location,
  PERMISSION_NAMES.Download_doc_zip,
];

const level3Permissions = [
  ...level2Permissions, 
  PERMISSION_NAMES.Screen_Monitoring,

  PERMISSION_NAMES.Notes_Edit,
  PERMISSION_NAMES.Notes_Delete,
  PERMISSION_NAMES.DocQR_Edit,
  PERMISSION_NAMES.DocQR_Delete,
  PERMISSION_NAMES.PhoneNumber_Edit,
  PERMISSION_NAMES.PhoneNumber_Delete,
  PERMISSION_NAMES.Locations_Edit,
  PERMISSION_NAMES.Locations_Delete,

  PERMISSION_NAMES.Premises_Edit,
  PERMISSION_NAMES.Premises_Delete,
  PERMISSION_NAMES.Enclosures_Edit,
  PERMISSION_NAMES.Enclosures_Delete,
  PERMISSION_NAMES.TerminalBlocks_Edit,
  PERMISSION_NAMES.TerminalBlocks_Delete,
  PERMISSION_NAMES.Signals_Edit,
  PERMISSION_NAMES.Signals_Delete,
  PERMISSION_NAMES.PC_Edit,
  PERMISSION_NAMES.PC_Delete,
  PERMISSION_NAMES.Servers_Edit,
  PERMISSION_NAMES.Servers_Delete,
  PERMISSION_NAMES.UPS_Edit,
  PERMISSION_NAMES.UPS_Delete,
  PERMISSION_NAMES.VirtualMachine_Edit,
  PERMISSION_NAMES.VirtualMachine_Delete,
];

const level4Permissions = [
  ...level3Permissions,
];

export const ROLE_PERMISSIONS = {
  адміністратор: ALL_PERMISSIONS.map((p) => p.name),
  1: level1Permissions,
  2: level2Permissions,
  3: level3Permissions,
  4: level4Permissions,
};

export const ALL_ROLES = Object.keys(ROLE_PERMISSIONS);
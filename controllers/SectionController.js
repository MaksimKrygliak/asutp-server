import SectionModel from "../models/Section.js";
import PremiseModel from "../models/Premise.js";
import EnclosureItemModel from "../models/EnclosureItem.js";
import VirtualMachineModel from "../models/VirtualMachine.js";
import TerminalBlockModel from "../models/TerminalBlock.js";
import SignalModel from "../models/Signal.js";
import ServerModel from "../models/Server.js";
import ComputerModel from "../models/Computer.js";
import UpsModel from "../models/Ups.js";
import mongoose from "mongoose";
import { universalCascadeDelete } from "../utils/universalCascadeDelete.js";

const ObjectId = mongoose.Types.ObjectId;

// --- 1. Пакетное создание ---
export const createBatch = async (req, res) => {
  try {
    const sectionsToProcess = req.body;
    if (!Array.isArray(sectionsToProcess) || sectionsToProcess.length === 0) {
      return res.status(400).json({ message: "Нет данных для создания." });
    }

    const docsToInsert = sectionsToProcess.map((section) => ({
      ...section,
      _id: new ObjectId(),
      __localId: new ObjectId(section.__localId),
      createdAt: new Date(),
      updatedAt: new Date(),
      isPendingDeletion: false,
    }));

    await SectionModel.insertMany(docsToInsert, { ordered: false });

    const successNewDocs = docsToInsert.map((doc) => ({
      __localId: doc.__localId.toString(),
      __serverId: doc._id.toString(),
      updatedAt: doc.updatedAt,
    }));

    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("Section Create Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// --- 2. Пакетное обновление ---
export const updateBatch = async (req, res) => {
  try {
    const sectionsToProcess = req.body;
    if (!Array.isArray(sectionsToProcess) || sectionsToProcess.length === 0) {
      return res.status(400).json({ message: "Нет данных для обновления." });
    }

    const bulkUpdateOps = sectionsToProcess.map((doc) => {
      const { _id, __localId, ...dataToUpdate } = doc;
      return {
        updateOne: {
          filter: { _id: new ObjectId(_id) },
          update: {
            $set: { ...dataToUpdate, updatedAt: new Date() },
          },
        },
      };
    });

    await SectionModel.bulkWrite(bulkUpdateOps);

    const successUpdatedDocs = sectionsToProcess.map((doc) => ({
      __localId: doc.__localId,
      _id: doc._id,
      updatedAt: new Date(),
    }));

    res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("Section Update Error:", error);
    res.status(500).json({ message: error.message });
  }
};

// --- 3. Каскадное удаление (Мягкое) ---
export const deleteBatch = async (req, res) => {
  const { ids } = req.body; // Получаем СЕРВЕРНЫЕ ID от клиента

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids должен быть массивом." });
  }

  // Строго конвертируем в ObjectId
  const validObjectIds = ids
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));

  if (validObjectIds.length === 0) {
    return res.json({ successIds: [], failedIds: [] });
  }

  try {
    // 1. Быстро достаем ЛОКАЛЬНЫЕ ID секций, чтобы вернуть их клиенту (Realm)
    const itemsToReturn = await SectionModel.find(
      { _id: { $in: validObjectIds } },
      "__localId"
    ).lean();

    const localIdsToReturn = itemsToReturn
      .map((item) => (item.__localId ? item.__localId.toString() : null))
      .filter(Boolean);

    // 2. 🔥 ЗАПУСКАЕМ УНИВЕРСАЛЬНУЮ РЕКУРСИЮ!
    // Говорим: "Удали все Section с этими ID и всё, что от них зависит"
    await universalCascadeDelete("Section", validObjectIds);

    // 3. Возвращаем локальные ID клиенту
    res.status(200).json({ success: true, successIds: localIdsToReturn });
  } catch (error) {
    console.error("Cascade Delete Error:", error);
    res.status(500).json({ message: "Ошибка при каскадном удалении." });
  }
};

// --- 4. Получение изменений ---
export const getChanges = async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : new Date(0);
  const serverCurrentTimestamp = new Date().toISOString();

  try {
    const allChanges = await SectionModel.find({
      $or: [{ updatedAt: { $gt: since } }, { createdAt: { $gt: since } }],
    }).lean();

    const createdOrUpdated = allChanges.filter((s) => !s.isPendingDeletion);

    // Возвращаем строго __localId для удаленных секций
    const deletedSectionsIds = allChanges
      .filter((s) => s.isPendingDeletion)
      .map((doc) => (doc.__localId ? doc.__localId.toString() : null))
      .filter(Boolean);

    res.json({
      createdOrUpdatedSections: createdOrUpdated.map((s) => ({
        ...s,
        _id: s._id.toString(),
        __localId: s.__localId.toString(),
      })),
      deletedSectionsIds, // Массив строк с локальными ID
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Section GetChanges Error:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// // --- 3. Каскадное удаление (Мягкое) ---
// export const deleteBatch = async (req, res) => {
//   const { ids } = req.body; // Получаем СЕРВЕРНЫЕ ID секций от клиента

//   if (!Array.isArray(ids) || ids.length === 0) {
//     return res.status(400).json({ message: "ids должен быть массивом." });
//   }

//   // Фильтруем на валидные ObjectId
//   const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));

//   if (validIds.length === 0) {
//     return res.json({ successIds: [], failedIds: [] });
//   }

//   try {
//     const now = new Date();
//     const cascadeUpdate = {
//       $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now },
//     };

//     // 0. Быстро достаем локальные ID для ответа клиенту перед каскадным удалением
//     const sectionsToReturn = await SectionModel.find(
//       { _id: { $in: validIds } },
//       "__localId"
//     ).lean();

//     const localIdsToReturn = sectionsToReturn
//       .map((s) => (s.__localId ? s.__localId.toString() : null))
//       .filter(Boolean);

//     // 1. Находим все ПОМЕЩЕНИЯ, принадлежащие этим секциям (по _id секций)
//     const premises = await PremiseModel.find({
//       section: { $in: validIds }, // Ищем по серверным ID
//     })
//       .select("_id __localId")
//       .lean();

//     const premServerIds = premises.map((p) => p._id);
//     const premLocalIds = premises.map((p) => p.__localId.toString());

//     // 2. Находим ПЕРВЫЙ уровень детей помещений (Серверы, ПК, Шкафы)
//     const [servers, computers, enclosures] = await Promise.all([
//       ServerModel.find({ premise: { $in: premLocalIds } })
//         .select("_id __localId")
//         .lean(),
//       ComputerModel.find({ premise: { $in: premLocalIds } })
//         .select("_id __localId")
//         .lean(),
//       EnclosureItemModel.find({ premise: { $in: premLocalIds } })
//         .select("_id __localId")
//         .lean(),
//     ]);

//     const srvServerIds = servers.map((s) => s._id);
//     const srvLocalIds = servers.map((s) => s.__localId.toString());
//     const compServerIds = computers.map((c) => c._id);
//     const compLocalIds = computers.map((c) => c.__localId.toString());
//     const enclServerIds = enclosures.map((e) => e._id);
//     const enclLocalIds = enclosures.map((e) => e.__localId.toString());

//     // 3. Находим ВТОРОЙ уровень (Клеммники)
//     const terminalBlocks = await TerminalBlockModel.find({
//       $or: [
//         { enclosureItem: { $in: enclServerIds } },
//         { enclosureItem: { $in: enclLocalIds } },
//       ],
//     })
//       .select("_id __localId")
//       .lean();

//     const termServerIds = terminalBlocks.map((t) => t._id);
//     const termLocalIds = terminalBlocks.map((t) => t.__localId.toString());

//     // 4. Массовое обновление всей иерархии
//     await Promise.all([
//       // УРОВЕНЬ 4: Сигналы
//       SignalModel.updateMany(
//         {
//           $or: [
//             { terminalBlock: { $in: termServerIds } },
//             { terminalBlock: { $in: termLocalIds } },
//           ],
//           isPendingDeletion: false,
//         },
//         cascadeUpdate
//       ),

//       // УРОВЕНЬ 3: Виртуалки и Клеммники
//       VirtualMachineModel.updateMany(
//         {
//           $or: [
//             { server: { $in: srvServerIds } },
//             { server: { $in: srvLocalIds } },
//             { computer: { $in: compServerIds } },
//             { computer: { $in: compLocalIds } },
//           ],
//           isPendingDeletion: false,
//         },
//         cascadeUpdate
//       ),

//       TerminalBlockModel.updateMany(
//         {
//           $or: [
//             { enclosureItem: { $in: enclServerIds } },
//             { enclosureItem: { $in: enclLocalIds } },
//           ],
//           isPendingDeletion: false,
//         },
//         cascadeUpdate
//       ),

//       // УРОВЕНЬ 2: Дети помещения
//       ServerModel.updateMany({ premise: { $in: premLocalIds } }, cascadeUpdate),
//       ComputerModel.updateMany(
//         { premise: { $in: premLocalIds } },
//         cascadeUpdate
//       ),
//       UpsModel.updateMany({ premise: { $in: premLocalIds } }, cascadeUpdate),
//       EnclosureItemModel.updateMany(
//         { premise: { $in: premLocalIds } },
//         cascadeUpdate
//       ),

//       // УРОВЕНЬ 1: Помещения
//       PremiseModel.updateMany(
//         { section: { $in: validIds } }, // Ищем по серверным ID
//         cascadeUpdate
//       ),

//       // УРОВЕНЬ 0: Сами секции
//       SectionModel.updateMany({ _id: { $in: validIds } }, cascadeUpdate), // Обновляем по серверным ID
//     ]);

//     // Возвращаем локальные ID клиенту
//     res.status(200).json({ success: true, successIds: localIdsToReturn });
//   } catch (error) {
//     console.error("Section Cascade Delete Error:", error);
//     res.status(500).json({ message: "Ошибка при каскадном удалении секции." });
//   }
// };

// // --- 4. Получение изменений ---
// export const getChanges = async (req, res) => {
//   const since = req.query.since ? new Date(req.query.since) : new Date(0);
//   const serverCurrentTimestamp = new Date().toISOString();

//   try {
//     const allChanges = await SectionModel.find({
//       $or: [{ updatedAt: { $gt: since } }, { createdAt: { $gt: since } }],
//     }).lean();

//     const createdOrUpdated = allChanges.filter((s) => !s.isPendingDeletion);

//     // Возвращаем __localId для удаленных секций
//     const deletedSectionsIds = allChanges
//       .filter((s) => s.isPendingDeletion)
//       .map((doc) => (doc.__localId ? doc.__localId.toString() : null))
//       .filter(Boolean);

//     res.json({
//       createdOrUpdatedSections: createdOrUpdated.map((s) => ({
//         ...s,
//         _id: s._id.toString(),
//         __localId: s.__localId.toString(),
//       })),
//       deletedSectionsIds, // Теперь это массив локальных ID
//       serverCurrentTimestamp,
//     });
//   } catch (error) {
//     console.error("Section GetChanges Error:", error);
//     res.status(500).json({ message: "Ошибка сервера" });
//   }
// };

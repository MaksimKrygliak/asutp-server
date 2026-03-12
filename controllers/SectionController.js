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

export const getSectionFullTree = async (req, res) => {
  try {
    const { id } = req.params;

    // 1. Безопасный поиск локации (без внешней toObjectId)
    const isValidObjectId = mongoose.Types.ObjectId.isValid(id);
    const query = isValidObjectId
      ? { $or: [{ _id: id }, { __localId: id }] }
      : { __localId: id };
    const section = await SectionModel.findOne(query).lean();

    if (!section)
      return res.status(404).json({ message: "Локацію не знайдено" });

    // 2. Ищем помещения
    const premises = await PremiseModel.find({ section: section._id }).lean();
    const premiseIds = premises.map((p) => p._id);

    // 3. Ищем базовое оборудование
    const [enclosures, computers, servers, ups] = await Promise.all([
      EnclosureItemModel.find({ premise: { $in: premiseIds } }).lean(),
      ComputerModel.find({ premise: { $in: premiseIds } }).lean(),
      ServerModel.find({ premise: { $in: premiseIds } }).lean(),
      UpsModel.find({ premise: { $in: premiseIds } }).lean(),
    ]);

    // 4. Ищем вложенное оборудование (Виртуальные машины и Клеммники)
    const computerIds = computers.map((c) => c._id);
    const serverIds = servers.map((s) => s._id);
    const enclosureIds = enclosures.map((e) => e._id);

    const [virtualMachines, terminalBlocks] = await Promise.all([
      VirtualMachineModel.find({
        $or: [
          { computer: { $in: computerIds } },
          { server: { $in: serverIds } },
        ],
      }).lean(),
      TerminalBlockModel.find({ enclosureItem: { $in: enclosureIds } }).lean(),
    ]);

    // 5. Ищем Сигналы внутри Клеммников
    const tbIds = terminalBlocks.map((tb) => tb._id);
    const signals = await SignalModel.find({
      terminalBlock: { $in: tbIds },
    }).lean();

    // 🔥 ХЕЛПЕР ДЛЯ ОЧИСТКИ (Спасаем Realm от undefined и переводим ObjectId в строки)
    const sanitize = (items) =>
      items.map((item) => ({
        ...item,
        _id: item._id?.toString(),
        __localId: item.__localId?.toString(),
        isWorking: item.isWorking !== undefined ? item.isWorking : true, // <-- Защита от краша Realm!
        premise: item.premise?.toString(),
        enclosureItem: item.enclosureItem?.toString(),
        ups: item.ups?.toString(),
        computer: item.computer?.toString(),
        server: item.server?.toString(),
        terminalBlock: item.terminalBlock?.toString(),
      }));

    // Повертаємо повний зріз дерева
    res.json({
      section: {
        ...section,
        _id: section._id.toString(),
        __localId: section.__localId.toString(),
      },
      premises: sanitize(premises),
      enclosures: sanitize(enclosures),
      computers: sanitize(computers),
      servers: sanitize(servers),
      ups: sanitize(ups),
      virtualMachines: sanitize(virtualMachines),
      terminalBlocks: sanitize(terminalBlocks),
      signals: sanitize(signals),
    });
  } catch (error) {
    console.error("Full Tree Error:", error);
    res.status(500).json({ message: "Помилка сервера" });
  }
};

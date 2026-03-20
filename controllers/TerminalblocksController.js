import TerminalBlockModel from "../models/TerminalBlock.js";
import EnclosureItemModel from "../models/EnclosureItem.js";
import mongoose from "mongoose";
import { universalCascadeDelete } from "../utils/universalCascadeDelete.js";

const ObjectId = mongoose.Types.ObjectId;

// Хелпер для безопасной конвертации в ObjectId
const toObjectId = (val) =>
  val && mongoose.Types.ObjectId.isValid(val) ? new ObjectId(val) : null;

// --- 1. CREATE BATCH ---
export const createBatch = async (req, res) => {
  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res.status(400).json({ message: "Нет данных для создания." });
    }

    // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ: Находим настоящие серверные _id шкафов
    const rawEnclosureIds = newItemsBatch
      .map((i) => i.enclosureItem)
      .filter(Boolean);
    const validEnclosureOids = rawEnclosureIds.map(toObjectId).filter(Boolean);

    const enclosures = await EnclosureItemModel.find(
      {
        $or: [
          { _id: { $in: validEnclosureOids } },
          { __localId: { $in: rawEnclosureIds } },
        ],
      },
      "_id __localId"
    ).lean();

    const enclosureMap = new Map();
    enclosures.forEach((e) => {
      enclosureMap.set(e._id.toString(), e._id);
      if (e.__localId) enclosureMap.set(e.__localId.toString(), e._id);
    });

    const docsToInsert = newItemsBatch.map((item) => {
      const realEnclosureId = item.enclosureItem
        ? enclosureMap.get(item.enclosureItem.toString())
        : null;

      return {
        ...item,
        _id: new ObjectId(),
        __localId: toObjectId(item.__localId),
        enclosureItem: realEnclosureId, // 100% ПРАВИЛЬНЫЙ СЕРВЕРНЫЙ ID
        createdAt: new Date(),
        updatedAt: new Date(),
        isPendingDeletion: false,
      };
    });

    await TerminalBlockModel.insertMany(docsToInsert, { ordered: false });

    const successNewDocs = docsToInsert.map((doc) => ({
      _id: doc._id.toString(),
      __localId: doc.__localId.toString(),
      updatedAt: doc.updatedAt,
    }));

    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("TerminalBlock Create Error:", error);
    res.status(500).json({ message: "Ошибка при создании клеммников." });
  }
};

// --- 2. UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  try {
    const updatedItems = req.body;
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
      return res.status(400).json({ message: "Нет данных для обновления." });
    }

    // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ ДЛЯ ОБНОВЛЕНИЯ
    const rawEnclosureIds = updatedItems
      .map((i) => i.enclosureItem)
      .filter(Boolean);
    const validEnclosureOids = rawEnclosureIds.map(toObjectId).filter(Boolean);

    const enclosures = await EnclosureItemModel.find(
      {
        $or: [
          { _id: { $in: validEnclosureOids } },
          { __localId: { $in: rawEnclosureIds } },
        ],
      },
      "_id __localId"
    ).lean();

    const enclosureMap = new Map();
    enclosures.forEach((e) => {
      enclosureMap.set(e._id.toString(), e._id);
      if (e.__localId) enclosureMap.set(e.__localId.toString(), e._id);
    });

    const bulkUpdateOps = updatedItems.map((item) => {
      const { _id, __localId, ...dataToUpdate } = item;
      const updateFields = { ...dataToUpdate, updatedAt: new Date() };

      if (dataToUpdate.hasOwnProperty("enclosureItem")) {
        const realEnclosureId = enclosureMap.get(
          dataToUpdate.enclosureItem?.toString()
        );
        updateFields.enclosureItem =
          realEnclosureId || toObjectId(dataToUpdate.enclosureItem);
      }

      return {
        updateOne: {
          filter: { _id: toObjectId(_id) }, // Поиск по серверному ID
          update: { $set: updateFields },
        },
      };
    });

    if (bulkUpdateOps.length > 0) {
      await TerminalBlockModel.bulkWrite(bulkUpdateOps);
    }

    const successUpdatedDocs = updatedItems.map((item) => ({
      __localId: item.__localId,
      _id: item._id,
      updatedAt: new Date(),
    }));

    res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("TerminalBlock Update Error:", error);
    res.status(500).json({ message: "Ошибка при обновлении клеммников." });
  }
};

// --- 3. DELETE BATCH (УНИВЕРСАЛЬНЫЙ КАСКАД) ---
export const deleteBatch = async (req, res) => {
  const { ids } = req.body; // Получаем СЕРВЕРНЫЕ ID от GenericSync

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids должен быть массивом." });
  }

  const validObjectIds = ids.map(toObjectId).filter(Boolean);

  if (validObjectIds.length === 0) {
    return res.json({ successIds: [], failedIds: [] });
  }

  try {
    // 1. Быстро достаем локальные ID для ответа клиенту
    const itemsToReturn = await TerminalBlockModel.find(
      { _id: { $in: validObjectIds } },
      "__localId"
    ).lean();

    const localIdsToReturn = itemsToReturn
      .map((i) => (i.__localId ? i.__localId.toString() : null))
      .filter(Boolean);

    // 2. 🔥 ВЫЗЫВАЕМ УНИВЕРСАЛЬНУЮ РЕКУРСИЮ!
    // Она сама найдет Сигналы (SignalModel), привязанные к этому клеммнику.
    await universalCascadeDelete("TerminalBlock", validObjectIds);

    // Возвращаем успех с локальными ID клиенту
    res.json({ success: true, successIds: localIdsToReturn });
  } catch (error) {
    console.error("TerminalBlock Delete Error:", error);
    res
      .status(500)
      .json({ message: "Ошибка сервера при удалении клеммников." });
  }
};

// --- 4. GET CHANGES ---
export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date().toISOString();

    const allChanges = await TerminalBlockModel.find({
      $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
    }).lean(); // Никаких populate! Возвращаем чистые данные.

    const createdOrUpdated = allChanges.filter(
      (item) => !item.isPendingDeletion
    );

    // 🔥 ВОЗВРАЩАЕМ __localId ДЛЯ УДАЛЕННЫХ
    const deletedIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((item) => (item.__localId ? item.__localId.toString() : null))
      .filter(Boolean);

    const simplifiedItems = createdOrUpdated.map(
      (item) => (
        {
          ...item,
          _id: item._id.toString(),
          __localId: item.__localId.toString(),
          enclosureItem: item.enclosureItem
            ? item.enclosureItem.toString()
            : null,
        }
      )
    );

    res.json({
      createdOrUpdatedTerminalBlocks: simplifiedItems,
      deletedTerminalBlockIds: deletedIds, // Возвращаем локальные ID удаленных
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("TerminalBlock GetChanges Error:", error);
    res.status(500).json({ message: "Не удалось получить изменения." });
  }
};

import SignalModel from "../models/Signal.js";
import TerminalBlockModel from "../models/TerminalBlock.js";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// --- 1. CREATE BATCH ---
export const createBatch = async (req, res) => {
  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res
        .status(400)
        .json({ message: "Нет данных для создания сигналов." });
    }

    // Собираем локальные ID родительских клеммников
    const localTerminalIds = [
      ...new Set(newItemsBatch.map((i) => i.terminalBlock).filter((id) => id)),
    ];

    // Находим серверные _id родителей
    const foundTerminals = await TerminalBlockModel.find({
      __localId: { $in: localTerminalIds.map((id) => new ObjectId(id)) },
    })
      .select("_id __localId")
      .lean();

    const terminalMap = foundTerminals.reduce((map, t) => {
      map[t.__localId.toString()] = t._id;
      return map;
    }, {});

    // Подготовка документов для вставки
    const docsToInsert = newItemsBatch
      .map((item) => {
        // 🔥 ИСПРАВЛЕНИЕ: Обязательно .toString(), так как ключи в мапе — строки
        const parentServerId = terminalMap[item.terminalBlock?.toString()];

        if (!parentServerId) {
          console.warn(`Клеммник для сигнала ${item.__localId} не найден.`);
          return null;
        }

        return {
          ...item,
          _id: new ObjectId(),
          __localId: new ObjectId(item.__localId),
          terminalBlock: parentServerId, // Привязка по серверному _id
          createdAt: new Date(),
          updatedAt: new Date(),
          isPendingDeletion: false,
        };
      })
      .filter((doc) => doc !== null);

    if (docsToInsert.length > 0) {
      await SignalModel.insertMany(docsToInsert, { ordered: false });
    }

    const successNewDocs = docsToInsert.map((doc) => ({
      _id: doc._id.toString(),
      __localId: doc.__localId.toString(),
      updatedAt: doc.updatedAt,
    }));

    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("Signal Create Error:", error);
    res.status(500).json({ message: "Ошибка при создании сигналов." });
  }
};

// --- 2. UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  try {
    const updatedItems = req.body;
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
      return res.status(400).json({ message: "Нет данных для обновления." });
    }

    const bulkUpdateOps = updatedItems.map((item) => {
      const { _id, __localId, ...dataToUpdate } = item;

      const updateFields = {
        ...dataToUpdate,
        updatedAt: new Date(),
      };

      if (dataToUpdate.terminalBlock) {
        updateFields.terminalBlock = new ObjectId(dataToUpdate.terminalBlock);
      }

      return {
        updateOne: {
          filter: { _id: new ObjectId(_id) },
          update: { $set: updateFields },
        },
      };
    });

    if (bulkUpdateOps.length > 0) {
      await SignalModel.bulkWrite(bulkUpdateOps);
    }

    const successUpdatedDocs = updatedItems.map((item) => ({
      __localId: item.__localId,
      _id: item._id,
      updatedAt: new Date(),
    }));

    res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("Signal Update Error:", error);
    res.status(500).json({ message: "Ошибка при обновлении сигналов." });
  }
};

// --- 3. DELETE BATCH (Мягкое удаление по localIds) ---
export const deleteBatch = async (req, res) => {
  // 🔥 ИСПРАВЛЕНИЕ: Ожидаем localIds от фронтенда
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids должен быть массивом." });
  }

  try {
    const now = new Date();
    // Преобразуем в ObjectId для корректного поиска
    const localObjectIds = ids.map((id) => new ObjectId(id));

    await SignalModel.updateMany(
      { _id: { $in: localObjectIds } },
      { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } }
    );

    // 🔥 ИСПРАВЛЕНИЕ: Возвращаем successDeletedLocalIds для корректной работы GenericSync
    res.json({ success: true, successDeletedLocalIds: ids });
  } catch (error) {
    console.error("Signal Delete Error:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении сигналов." });
  }
};

// --- 4. GET CHANGES ---
export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date().toISOString();

    const allChanges = await SignalModel.find({
      $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
    }).lean();

    const createdOrUpdated = allChanges.filter(
      (item) => !item.isPendingDeletion
    );
    const deletedSignalIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((doc) => doc.__localId.toString());

    const simplifiedItems = createdOrUpdated.map((item) => ({
      ...item,
      _id: item._id.toString(),
      __localId: item.__localId.toString(),
      // 🔥 ИСПРАВЛЕНИЕ: Безопасное приведение к строке
      terminalBlock: item.terminalBlock ? item.terminalBlock.toString() : null,
    }));

    res.json({
      createdOrUpdatedSignals: simplifiedItems,
      deletedSignalIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Signal GetChanges Error:", error);
    res.status(500).json({ message: "Не удалось получить изменения." });
  }
};

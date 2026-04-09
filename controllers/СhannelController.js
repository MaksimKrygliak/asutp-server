import SignalModel from "../models/Signal.js";
import TerminalBlockModel from "../models/TerminalBlock.js";
import mongoose from "mongoose";

const ObjectId = mongoose.Types.ObjectId;

// Хелпер для безопасной конвертации в ObjectId
const toObjectId = (val) =>
  val && mongoose.Types.ObjectId.isValid(val) ? new ObjectId(val) : null;

// --- 1. CREATE BATCH ---
export const createBatch = async (req, res) => {
  try {
    const newItemsBatch = req.body;
    if (!Array.isArray(newItemsBatch) || newItemsBatch.length === 0) {
      return res
        .status(400)
        .json({ message: "Нет данных для создания сигналов." });
    }

    // Собираем ID родительских клеммников (это могут быть как серверные _id, так и __localId)
    const rawTerminalIds = [
      ...new Set(newItemsBatch.map((i) => i.terminalBlock).filter(Boolean)),
    ];
    const validTerminalOids = rawTerminalIds.map(toObjectId).filter(Boolean);

    // 🔥 ИСЦЕЛЕНИЕ СВЯЗЕЙ: Находим серверные _id родителей по ОБЕИМ колонкам
    const foundTerminals = await TerminalBlockModel.find({
      $or: [
        { _id: { $in: validTerminalOids } },
        { __localId: { $in: validTerminalOids } },
      ],
    })
      .select("_id __localId")
      .lean();

    // Создаем универсальную карту
    const terminalMap = new Map();
    foundTerminals.forEach((t) => {
      terminalMap.set(t._id.toString(), t._id);
      if (t.__localId) terminalMap.set(t.__localId.toString(), t._id);
    });

    // Подготовка документов для вставки
    const docsToInsert = newItemsBatch
      .map((item) => {
        const parentServerId = terminalMap.get(item.terminalBlock?.toString());

        if (!parentServerId) {
          console.warn(`Клеммник для сигнала ${item.__localId} не найден.`);
          return null;
        }

        return {
          ...item,
          _id: new ObjectId(),
          __localId: toObjectId(item.__localId),
          terminalBlock: parentServerId, // Привязка по 100% правильному серверному _id
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

    // Делаем такую же страховку связей для обновления
    const rawTerminalIds = updatedItems
      .map((i) => i.terminalBlock)
      .filter(Boolean);
    const validTerminalOids = rawTerminalIds.map(toObjectId).filter(Boolean);

    const foundTerminals = await TerminalBlockModel.find({
      $or: [
        { _id: { $in: validTerminalOids } },
        { __localId: { $in: validTerminalOids } },
      ],
    })
      .select("_id __localId")
      .lean();

    const terminalMap = new Map();
    foundTerminals.forEach((t) => {
      terminalMap.set(t._id.toString(), t._id);
      if (t.__localId) terminalMap.set(t.__localId.toString(), t._id);
    });

    const bulkUpdateOps = updatedItems.map((item) => {
      const { _id, __localId, ...dataToUpdate } = item;
      const updateFields = { ...dataToUpdate, updatedAt: new Date() };

      if (dataToUpdate.terminalBlock) {
        const realTerminalId = terminalMap.get(
          dataToUpdate.terminalBlock?.toString()
        );
        updateFields.terminalBlock =
          realTerminalId || toObjectId(dataToUpdate.terminalBlock);
      }

      return {
        updateOne: {
          filter: { _id: toObjectId(_id) },
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

// --- 3. DELETE BATCH (Мягкое удаление) ---
export const deleteBatch = async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids должен быть массивом." });
  }

  try {
    const now = new Date();
    const localObjectIds = ids.map(toObjectId).filter(Boolean);

    await SignalModel.updateMany(
      { _id: { $in: localObjectIds } },
      { $set: { isPendingDeletion: true, deletedAt: now, updatedAt: now } }
    );

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
      .map((doc) => doc.__localId?.toString())
      .filter(Boolean);

    const simplifiedItems = createdOrUpdated.map((item) => ({
      ...item,
      _id: item._id.toString(),
      __localId: item.__localId?.toString(),
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

import ComputerModel from "../models/Computer.js";
import PremiseModel from "../models/Premise.js";
import UpsModel from "../models/Ups.js"; // Импорт для исцеления связей UPS
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

    // 1. ИЩЕМ ПОМЕЩЕНИЯ ПО ЛОКАЛЬНЫМ ID (СТРОКАМ) И СТРОИМ КАРТУ
    const rawPremiseIds = newItemsBatch.map((i) => i.premise).filter(Boolean);

    // Поиск сработает отлично, потому что база будет сравнивать строки со строками!
    const premises = await PremiseModel.find(
      { __localId: { $in: rawPremiseIds } },
      "_id __localId"
    ).lean();

    const premiseMap = new Map();
    premises.forEach((p) => {
      // Ключ: строка (UUID), Значение: настоящий серверный ObjectId
      if (p.__localId) premiseMap.set(p.__localId.toString(), p._id);
    });

    // 2. ИЩЕМ ИБП (UPS) И СТРОИМ КАРТУ
    const rawUpsIds = newItemsBatch.map((i) => i.ups).filter(Boolean);

    const upsList = await UpsModel.find(
      { __localId: { $in: rawUpsIds } },
      "_id __localId"
    ).lean();

    const upsMap = new Map();
    upsList.forEach((u) => {
      if (u.__localId) upsMap.set(u.__localId.toString(), u._id);
    });

    // 3. ФОРМИРУЕМ ДОКУМЕНТЫ ДЛЯ ВСТАВКИ
    const docsToInsert = newItemsBatch.map((item) => {
      // 🔥 МАГИЯ КАРТЫ: мы даем ей строку item.premise, а получаем ObjectId!
      const realPremiseId = item.premise
        ? premiseMap.get(item.premise.toString())
        : null;
      const realUpsId = item.ups ? upsMap.get(item.ups.toString()) : null;

      return {
        ...item,
        _id: new ObjectId(), // Генерируем новый серверный ID для самого ПК
        __localId: item.__localId, // Оставляем строкой (UUID)
        premise: realPremiseId, // Записываем чистый ObjectId помещения!
        ups: realUpsId, // Записываем чистый ObjectId ИБП!
        createdAt: new Date(),
        updatedAt: new Date(),
        isPendingDeletion: false,
      };
    });

    // 4. МАССОВОЕ СОХРАНЕНИЕ В БАЗУ
    await ComputerModel.insertMany(docsToInsert, { ordered: false });

    // 5. ОТВЕТ КЛИЕНТУ
    const successNewDocs = docsToInsert.map((doc) => ({
      _id: doc._id.toString(),
      __localId: doc.__localId,
      updatedAt: doc.updatedAt,
    }));

    res.json({ successNewDocs, failedNewDocs: [] });
  } catch (error) {
    console.error("Computer Create Error:", error);
    res.status(500).json({ message: "Ошибка при создании ПК." });
  }
};

// --- 2. UPDATE BATCH ---
export const updateBatch = async (req, res) => {
  try {
    const updatedItems = req.body;
    if (!Array.isArray(updatedItems) || updatedItems.length === 0) {
      return res.status(400).json({ message: "Нет данных для обновления." });
    }

    // ИСЦЕЛЕНИЕ СВЯЗЕЙ С ПОМЕЩЕНИЕМ
    const rawPremiseIds = updatedItems.map((i) => i.premise).filter(Boolean);
    const validPremiseOids = rawPremiseIds.map(toObjectId).filter(Boolean);

    const premises = await PremiseModel.find(
      {
        $or: [
          { _id: { $in: validPremiseOids } },
          { __localId: { $in: rawPremiseIds } },
        ],
      },
      "_id __localId"
    ).lean();

    const premiseMap = new Map();
    premises.forEach((p) => {
      premiseMap.set(p._id.toString(), p._id);
      if (p.__localId) premiseMap.set(p.__localId.toString(), p._id);
    });

    // ИСЦЕЛЕНИЕ СВЯЗЕЙ С UPS
    const rawUpsIds = updatedItems.map((i) => i.ups).filter(Boolean);
    const validUpsOids = rawUpsIds.map(toObjectId).filter(Boolean);

    const upsList = await UpsModel.find(
      {
        $or: [
          { _id: { $in: validUpsOids } },
          { __localId: { $in: rawUpsIds } },
        ],
      },
      "_id __localId"
    ).lean();

    const upsMap = new Map();
    upsList.forEach((u) => {
      upsMap.set(u._id.toString(), u._id);
      if (u.__localId) upsMap.set(u.__localId.toString(), u._id);
    });

    const bulkUpdateOps = updatedItems.map((item) => {
      const { _id, __localId, ...dataToUpdate } = item;
      const updateFields = { ...dataToUpdate, updatedAt: new Date() };

      if (dataToUpdate.hasOwnProperty("premise")) {
        const realPremiseId = premiseMap.get(dataToUpdate.premise?.toString());
        updateFields.premise =
          realPremiseId || toObjectId(dataToUpdate.premise);
      }

      if (dataToUpdate.hasOwnProperty("ups")) {
        const realUpsId = upsMap.get(dataToUpdate.ups?.toString());
        updateFields.ups = realUpsId || toObjectId(dataToUpdate.ups);
      }

      return {
        updateOne: {
          filter: { _id: toObjectId(_id) },
          update: { $set: updateFields },
        },
      };
    });

    if (bulkUpdateOps.length > 0) {
      await ComputerModel.bulkWrite(bulkUpdateOps);
    }

    const successUpdatedDocs = updatedItems.map((item) => ({
      __localId: item.__localId,
      _id: item._id,
      updatedAt: new Date(),
    }));

    res.json({ successUpdatedDocs, failedUpdatedDocs: [] });
  } catch (error) {
    console.error("Computer Update Error:", error);
    res.status(500).json({ message: "Ошибка при обновлении ПК." });
  }
};

// --- 3. DELETE BATCH (УНИВЕРСАЛЬНЫЙ КАСКАД) ---
export const deleteBatch = async (req, res) => {
  const { ids } = req.body; // Получаем серверные ID от GenericSync

  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ message: "ids должен быть массивом." });
  }

  const validObjectIds = ids.map(toObjectId).filter(Boolean);

  if (validObjectIds.length === 0) {
    return res.json({ successIds: [], failedIds: [] });
  }

  try {
    // Достаем __localId для ответа клиенту
    const itemsToReturn = await ComputerModel.find(
      { _id: { $in: validObjectIds } },
      "__localId"
    ).lean();

    const localIdsToReturn = itemsToReturn
      .map((i) => (i.__localId ? i.__localId.toString() : null))
      .filter(Boolean);

    // 🔥 МАГИЯ: Универсальное каскадное удаление (оно само найдет VirtualMachine)
    await universalCascadeDelete("Computer", validObjectIds);

    // Возвращаем правильный ключ successIds
    res.json({ success: true, successIds: localIdsToReturn });
  } catch (error) {
    console.error("Computer Delete Error:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении ПК." });
  }
};

// --- 4. GET CHANGES ---
export const getChanges = async (req, res) => {
  try {
    const lastSync = req.query.since ? new Date(req.query.since) : new Date(0);
    const serverCurrentTimestamp = new Date().toISOString();

    const allChanges = await ComputerModel.find({
      $or: [{ createdAt: { $gt: lastSync } }, { updatedAt: { $gt: lastSync } }],
    }).lean();

    const createdOrUpdated = allChanges.filter(
      (item) => !item.isPendingDeletion
    );

    // 🔥 ИСПРАВЛЕНИЕ: Возвращаем __localId вместо _id
    const deletedIds = allChanges
      .filter((item) => item.isPendingDeletion)
      .map((item) => (item.__localId ? item.__localId.toString() : null))
      .filter(Boolean);

    const simplifiedItems = createdOrUpdated.map((item) => ({
      ...item,
      _id: item._id.toString(),
      __localId: item.__localId.toString(),
      premise: item.premise ? item.premise.toString() : null,
      ups: item.ups ? item.ups.toString() : null,
    }));

    res.json({
      createdOrUpdatedComputers: simplifiedItems,
      deletedComputerIds: deletedIds,
      serverCurrentTimestamp,
    });
  } catch (error) {
    console.error("Computer GetChanges Error:", error);
    res.status(500).json({ message: "Не удалось получить изменения." });
  }
};

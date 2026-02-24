//PostController
import PostModel from "../models/Post.js";
import User from "../models/User.js";
import Section from "../models/Section.js";
import Premise from "../models/Premise.js";
import EnclosureItem from "../models/EnclosureItem.js";
import mongoose from "mongoose";
import { sendPushNotification } from "../utils/notificationService.js";

// Хелпер: Превращает строку в ObjectId или null
const toObjectId = (value) => {
  if (value && mongoose.Types.ObjectId.isValid(value))
    return new mongoose.Types.ObjectId(value);
  return null;
};

const createIdMap = async (Model, ids) => {
  if (!ids || ids.length === 0) return {};

  // 1. Разделяем входящие ID на "похожие на ObjectId" и "остальные (локальные)"
  const possibleObjectIds = ids.filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );
  const localIds = ids; // Ищем по всем как по localId

  // 2. Выполняем поиск
  const docs = await Model.find({
    $or: [
      { __localId: { $in: localIds } },
      { _id: { $in: possibleObjectIds } },
    ],
  })
    .select("__localId _id")
    .lean();

  // 3. Собираем карту
  return docs.reduce((acc, doc) => {
    if (doc.__localId) acc[doc.__localId] = doc._id; // Map: local -> server
    acc[doc._id.toString()] = doc._id; // Map: server -> server (для надежности)
    return acc;
  }, {});
};

export const batchCreate = async (req, res) => {
  const userId = req.userId;
  const arrNotes = Array.isArray(req.body) ? req.body : [];

  if (arrNotes.length === 0)
    return res.json({ successNewDocs: [], failedNewDocs: [] });

  // --- ЭТАП 1: СБОР ВСЕХ ССЫЛОК ---
  const locationIds = new Set();
  const premiseIds = new Set();
  const enclosureIds = new Set();
  const userIds = new Set();

  arrNotes.forEach((note) => {
    if (note.location) locationIds.add(note.location);
    if (note.premise) premiseIds.add(note.premise);
    if (note.enclosure) enclosureIds.add(note.enclosure);

    const uId = note.user;
    if (uId) userIds.add(uId);
  });

  // --- ЭТАП 2: БЫСТРЫЙ ПОИСК (Batch Lookup) ---
  // Делаем 4 параллельных запроса вместо N * 4
  const [locationMap, premiseMap, enclosureMap, userMap] = await Promise.all([
    createIdMap(Section, Array.from(locationIds)),
    createIdMap(Premise, Array.from(premiseIds)),
    createIdMap(EnclosureItem, Array.from(enclosureIds)),
    createIdMap(User, Array.from(userIds)),
  ]);

  // --- ЭТАП 3: ПОДГОТОВКА И ВСТАВКА ---
  const postsToInsert = [];
  const validationResults = [];

  arrNotes.forEach((itemData, index) => {
    const rawLocalId = itemData.__localId;

    // Валидация __localId (мы договорились, что это строка)
    if (!rawLocalId) {
      validationResults.push({
        __localId: `idx-${index}`,
        success: false,
        error: "No __localId",
      });
      return;
    }

    try {
      // Резолвинг User ID
      let resolvedUser = userId; // По умолчанию - текущий
      const incomingUser =
        typeof itemData.user === "object"
          ? itemData.user.__localId || itemData.user._id
          : itemData.user;
      if (incomingUser && userMap[incomingUser]) {
        resolvedUser = userMap[incomingUser];
      }

      const newPost = {
        __localId: rawLocalId,
        title: itemData.title,
        text: itemData.text,
        type: itemData.type,

        // 🔥 МАГИЯ: Мгновенная подстановка ID из карты
        // Если ID не найден в карте, ставим null (связь невозможна)
        location: locationMap[itemData.location] || null,
        premise: premiseMap[itemData.premise] || null,
        enclosure: enclosureMap[itemData.enclosure] || null,

        tags: itemData.tags || [],
        user: resolvedUser,
        viewedByUsers: [], // TODO: Можно реализовать аналогично через userMap
        resolved: itemData.resolved,
        isPendingDeletion: itemData.isPendingDeletion || false,
      };

      postsToInsert.push(newPost);
      validationResults.push({ __localId: rawLocalId, success: null });
    } catch (e) {
      validationResults.push({
        __localId: rawLocalId,
        success: false,
        error: e.message,
      });
    }
  });

  if (postsToInsert.length === 0) {
    return res.json({
      successNewDocs: [],
      failedNewDocs: validationResults.filter((r) => !r.success),
    });
  }

  // --- ЭТАП 4: ВСТАВКА ---
  try {
    const insertResult = await PostModel.insertMany(postsToInsert, {
      ordered: false,
    });

    insertResult.forEach((doc) => {
      const entry = validationResults.find(
        (r) => r.__localId === doc.__localId
      );
      if (entry) {
        entry.success = true;
        entry.serverId = doc._id;
        entry.updatedAt = doc.updatedAt;
      }
    });

    // ... PUSH NOTIFICATIONS ...

    const finalSuccessDocs = validationResults
      .filter((r) => r.success)
      .map((r) => ({
        __localId: r.__localId,
        _id: r.serverId,
        updatedAt: r.updatedAt,
      }));

    const finalFailedDocs = validationResults
      .filter((r) => !r.success)
      .map((r) => ({
        __localId: r.__localId,
        message: r.error,
      }));

    return res.json({
      successNewDocs: finalSuccessDocs,
      failedNewDocs: finalFailedDocs,
    });
  } catch (error) {
    // Обработка ошибок BulkWrite (как мы делали раньше)
    if (error.writeErrors) {
      // ... копируем логику из предыдущего ответа
      // (она стандартная для insertMany)
      return res.json({
        /* ... */
      });
    }
    console.error("Fatal Batch Create Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const batchUpdatePosts = async (req, res) => {
  const updates = req.body;
  if (!Array.isArray(updates) || updates.length === 0)
    return res.json({ successUpdates: [], failedUpdates: [] });

  // --- ЭТАП 1: СБОР ВСЕХ ССЫЛОК ДЛЯ ИСЦЕЛЕНИЯ ---
  const locationIds = new Set();
  const premiseIds = new Set();
  const enclosureIds = new Set();
  const userIds = new Set();

  updates.forEach((update) => {
    // ВАЖНО: Добавляем в Set только если поле реально существует и не пустое
    if (update.location) locationIds.add(String(update.location));
    if (update.premise) premiseIds.add(String(update.premise));
    if (update.enclosure) enclosureIds.add(String(update.enclosure));

    if (update.user) {
      const uId =
        typeof update.user === "object"
          ? update.user.__localId || update.user._id
          : update.user;
      if (uId) userIds.add(String(uId));
    }
  });

  // --- ЭТАП 2: БЫСТРЫЙ ПОИСК И СОЗДАНИЕ СЛОВАРЕЙ ---
  // ВНИМАНИЕ: Убедитесь, что Section, Premise, EnclosureItem, User - это валидные Mongoose-модели,
  // импортированные в начале файла (например, import Section from "../models/Section.js";)
  let locationMap = {},
    premiseMap = {},
    enclosureMap = {},
    userMap = {};

  try {
    const results = await Promise.all([
      createIdMap(Section, Array.from(locationIds)),
      createIdMap(Premise, Array.from(premiseIds)),
      createIdMap(EnclosureItem, Array.from(enclosureIds)),
      createIdMap(User, Array.from(userIds)),
    ]);
    locationMap = results[0];
    premiseMap = results[1];
    enclosureMap = results[2];
    userMap = results[3];
  } catch (mapError) {
    console.error("Error creating ID maps:", mapError);
    // Если маппинг упал, мы должны прервать работу, иначе запишем мусор в БД
    return res
      .status(500)
      .json({ message: "Error resolving relations", error: mapError.message });
  }

  const successUpdates = [];
  const failedUpdates = [];

  // --- ЭТАП 3: ЦИКЛ ОБНОВЛЕНИЯ ---
  for (const postUpdate of updates) {
    const { _id, __localId, ...dataToUpdate } = postUpdate;

    if (!_id || !mongoose.Types.ObjectId.isValid(_id)) {
      failedUpdates.push({ __localId, _id, message: "Invalid server_id" });
      continue;
    }

    try {
      const updatePayload = {
        ...dataToUpdate,
        updatedAt: new Date(),
      };

      // 🔥 МАГИЯ ИСЦЕЛЕНИЯ: Подменяем локальные ID на серверные _id перед записью в БД.
      // ВАЖНО: Проверяем через hasOwnProperty, чтобы не затереть поле в БД нулем (null),
      // если клиент его просто не прислал для обновления!

      if (Object.prototype.hasOwnProperty.call(updatePayload, "location")) {
        updatePayload.location = updatePayload.location
          ? locationMap[updatePayload.location] || null
          : null;
      }

      if (Object.prototype.hasOwnProperty.call(updatePayload, "premise")) {
        updatePayload.premise = updatePayload.premise
          ? premiseMap[updatePayload.premise] || null
          : null;
      }

      if (Object.prototype.hasOwnProperty.call(updatePayload, "enclosure")) {
        updatePayload.enclosure = updatePayload.enclosure
          ? enclosureMap[updatePayload.enclosure] || null
          : null;
      }

      // Обработка user
      if (
        Object.prototype.hasOwnProperty.call(updatePayload, "user") &&
        updatePayload.user
      ) {
        const incomingUser =
          typeof updatePayload.user === "object"
            ? updatePayload.user.__localId || updatePayload.user._id
            : updatePayload.user;

        updatePayload.user = userMap[incomingUser] || updatePayload.user; // fallback на исходный
      }

      // Обновляем саму нотатку в базе данных
      const updatedPost = await PostModel.findByIdAndUpdate(
        _id,
        updatePayload,
        { new: true, runValidators: true }
      );

      if (updatedPost) {
        successUpdates.push({
          __localId: __localId,
          _id: updatedPost._id.toString(),
          updatedAt: updatedPost.updatedAt,
        });
      } else {
        failedUpdates.push({ __localId, _id, message: "Post not found" });
      }
    } catch (error) {
      console.error(`Error updating post ${_id}:`, error);
      failedUpdates.push({ __localId, _id, message: error.message });
    }
  }

  return res.json({ successUpdates, failedUpdates });
};

export const batchDeletePosts = async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids))
    return res.status(400).json({ message: "IDs must be an array" });

  const validIds = ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
  // Если прислали пустоту или мусор - отвечаем успехом, но ничего не делаем
  if (validIds.length === 0) return res.json({ successIds: [], failedIds: [] });

  try {
    // Soft Delete: ставим флаг и дату
    await PostModel.updateMany(
      { _id: { $in: validIds } },
      {
        $set: {
          isPendingDeletion: true,
          deletedAt: new Date(),
          updatedAt: new Date(),
        },
      }
    );

    // Возвращаем клиенту те ID, которые он просил удалить
    return res.json({
      successIds: validIds,
      failedIds: [],
    });
  } catch (error) {
    console.error("Batch Delete Error:", error);
    return res.status(500).json({ message: error.message });
  }
};

export const getChanges = async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0);

    // 1. Находим созданные или обновленные посты
    const createdOrUpdatedPosts = await PostModel.find({
      updatedAt: { $gte: since },
      isPendingDeletion: false,
    })
      .populate("user", "fullName email") // Подтягиваем инфу о пользователе
      .lean()
      .exec();

    // console.log("createdOrUpdatedPosts", createdOrUpdatedPosts)
    // 2. Собираем уникальных пользователей для кеша
    const allUserIdsInChanges = new Set();
    createdOrUpdatedPosts.forEach((post) => {
      if (post.user && post.user._id) {
        allUserIdsInChanges.add(post.user._id.toString());
      }
    });
    // console.log("createdOrUpdatedPosts", createdOrUpdatedPosts)

    // ВНИМАНИЕ: Убедитесь, что импортирована правильная модель пользователя (UserModel или User)
    const referencedUsers = await User.find(
      { _id: { $in: Array.from(allUserIdsInChanges) } },
      "fullName"
    ).lean();

    // console.log(referencedUsers)

    // 🔥 ИСПРАВЛЕНИЕ: ЖЕСТКОЕ ФОРМАТИРОВАНИЕ ДАННЫХ ДЛЯ КЛИЕНТА 🔥
    // Гарантируем, что все ID уходят в виде чистых строк (серверных _id)
    const mappedPosts = createdOrUpdatedPosts.map((post) => ({
      ...post,
      _id: post._id ? post._id.toString() : null,
      __localId: post.__localId ? post.__localId.toString() : null,

      // Связи: отдаем строковый серверный _id
      location: post.location ? post.location.toString() : null,
      premise: post.premise ? post.premise.toString() : null,
      enclosure: post.enclosure ? post.enclosure.toString() : null,

      // Пользователь: так как мы сделали populate, берем _id из вложенного объекта
      user: post.user
        ? post.user._id
          ? post.user._id.toString()
          : post.user.toString()
        : null,
    }));

    // 3. Удаленные посты (Возвращаем __localId!)
    const deletedPosts = await PostModel.find(
      {
        isPendingDeletion: true,
        updatedAt: { $gte: since },
      },
      "__localId"
    ).lean();

    const deletedLocalIds = deletedPosts
      .map((doc) => doc.__localId?.toString())
      .filter(Boolean); // Оставляем только валидные значения

    res.json({
      createdOrUpdatedPosts: mappedPosts, // Отправляем отформатированный массив!
      deletedPostIds: deletedLocalIds,
      serverCurrentTimestamp: new Date().toISOString(),
      referencedUsers,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Error getting changes", error: err.message });
  }
};

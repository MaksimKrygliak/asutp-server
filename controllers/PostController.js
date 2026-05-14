import mongoose from "mongoose";
import PostModel from "../models/Post.js";
import User from "../models/User.js";
import Section from "../models/Section.js";
import Premise from "../models/Premise.js";
import EnclosureItem from "../models/EnclosureItem.js";
import Computer from "../models/Computer.js";
import Server from "../models/Server.js";
import UPS from "../models/Ups.js";

const createIdMap = async (Model, ids) => {
  if (!ids || ids.length === 0) return {};

  const possibleObjectIds = ids.filter((id) =>
    mongoose.Types.ObjectId.isValid(id)
  );

  const docs = await Model.find({
    $or: [{ __localId: { $in: ids } }, { _id: { $in: possibleObjectIds } }],
  })
    .select("__localId _id")
    .lean();

  return docs.reduce((acc, doc) => {
    if (doc.__localId) acc[doc.__localId] = doc._id;
    acc[doc._id.toString()] = doc._id;
    return acc;
  }, {});
};

export const batchCreate = async (req, res) => {
  const userId = req.userId;
  const arrNotes = Array.isArray(req.body) ? req.body : [];
  if (arrNotes.length === 0)
    return res.json({ successNewDocs: [], failedNewDocs: [] });

  const locationIds = new Set();
  const premiseIds = new Set();
  const enclosureIds = new Set();
  const computerIds = new Set();
  const serverIds = new Set();
  const upsIds = new Set();
  const userIds = new Set();

  arrNotes.forEach((note) => {
    if (note.location) locationIds.add(note.location);
    if (note.premise) premiseIds.add(note.premise);
    if (note.enclosure) enclosureIds.add(note.enclosure);
    if (note.computer) computerIds.add(note.computer);
    if (note.server) serverIds.add(note.server);
    if (note.ups) upsIds.add(note.ups);
    if (note.user) userIds.add(note.user);
  });

  const [
    locationMap,
    premiseMap,
    enclosureMap,
    computerMap,
    serverMap,
    upsMap,
    userMap,
  ] = await Promise.all([
    createIdMap(Section, Array.from(locationIds)),
    createIdMap(Premise, Array.from(premiseIds)),
    createIdMap(EnclosureItem, Array.from(enclosureIds)),
    createIdMap(Computer, Array.from(computerIds)),
    createIdMap(Server, Array.from(serverIds)),
    createIdMap(UPS, Array.from(upsIds)),
    createIdMap(User, Array.from(userIds)),
  ]);

  const postsToInsert = [];
  const validationResults = [];

  arrNotes.forEach((itemData, index) => {
    const rawLocalId = itemData.__localId;

    if (!rawLocalId) {
      validationResults.push({
        __localId: `idx-${index}`,
        success: false,
        error: "No __localId",
      });
      return;
    }

    try {
      let resolvedUser = userId;
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
        location: locationMap[itemData.location] || null,
        premise: premiseMap[itemData.premise] || null,
        enclosure: enclosureMap[itemData.enclosure] || null,
        computer: computerMap[itemData.computer] || null,
        server: serverMap[itemData.server] || null,
        ups: upsMap[itemData.ups] || null,
        tags: itemData.tags || [],
        user: resolvedUser,
        viewedByUsers: [],
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
    return res.status(500).json({ message: error.message });
  }
};

export const batchUpdatePosts = async (req, res) => {
  const updates = req.body;
  if (!Array.isArray(updates) || updates.length === 0)
    return res.json({ successUpdates: [], failedUpdates: [] });

  const locationIds = new Set();
  const premiseIds = new Set();
  const enclosureIds = new Set();
  const computerIds = new Set();
  const serverIds = new Set();
  const upsIds = new Set();
  const userIds = new Set();

  updates.forEach((update) => {
    if (update.location) locationIds.add(String(update.location));
    if (update.premise) premiseIds.add(String(update.premise));
    if (update.enclosure) enclosureIds.add(String(update.enclosure));
    if (update.computer) computerIds.add(String(update.computer));
    if (update.server) serverIds.add(String(update.server));
    if (update.ups) upsIds.add(String(update.ups));

    if (update.user) {
      const uId =
        typeof update.user === "object"
          ? update.user.__localId || update.user._id
          : update.user;
      if (uId) userIds.add(String(uId));
    }
  });

  let locationMap = {},
    premiseMap = {},
    enclosureMap = {},
    computerMap = {},
    serverMap = {},
    upsMap = {},
    userMap = {};

  try {
    const results = await Promise.all([
      createIdMap(Section, Array.from(locationIds)),
      createIdMap(Premise, Array.from(premiseIds)),
      createIdMap(EnclosureItem, Array.from(enclosureIds)),
      createIdMap(Computer, Array.from(computerIds)),
      createIdMap(Server, Array.from(serverIds)),
      createIdMap(UPS, Array.from(upsIds)),
      createIdMap(User, Array.from(userIds)),
    ]);
    locationMap = results[0];
    premiseMap = results[1];
    enclosureMap = results[2];
    computerMap = results[3];
    serverMap = results[4];
    upsMap = results[5];
    userMap = results[6];
  } catch (mapError) {
    return res
      .status(500)
      .json({ message: "Error resolving relations", error: mapError.message });
  }

  const successUpdates = [];
  const failedUpdates = [];

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
      if (Object.prototype.hasOwnProperty.call(updatePayload, "computer")) {
        updatePayload.computer = updatePayload.computer
          ? computerMap[updatePayload.computer] || null
          : null;
      }
      if (Object.prototype.hasOwnProperty.call(updatePayload, "server")) {
        updatePayload.server = updatePayload.server
          ? serverMap[updatePayload.server] || null
          : null;
      }
      if (Object.prototype.hasOwnProperty.call(updatePayload, "ups")) {
        updatePayload.ups = updatePayload.ups
          ? upsMap[updatePayload.ups] || null
          : null;
      }

      if (
        Object.prototype.hasOwnProperty.call(updatePayload, "user") &&
        updatePayload.user
      ) {
        const incomingUser =
          typeof updatePayload.user === "object"
            ? updatePayload.user.__localId || updatePayload.user._id
            : updatePayload.user;

        updatePayload.user = userMap[incomingUser] || updatePayload.user;
      }

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
  if (validIds.length === 0) return res.json({ successIds: [], failedIds: [] });

  try {
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

    return res.json({
      successIds: validIds,
      failedIds: [],
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const getChanges = async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0);

    const createdOrUpdatedPosts = await PostModel.find({
      updatedAt: { $gte: since },
      isPendingDeletion: false,
    })
      .populate("user", "fullName email")
      .lean()
      .exec();

    const allUserIdsInChanges = new Set();
    createdOrUpdatedPosts.forEach((post) => {
      if (post.user && post.user._id) {
        allUserIdsInChanges.add(post.user._id.toString());
      }
    });

    const referencedUsers = await User.find(
      { _id: { $in: Array.from(allUserIdsInChanges) } },
      "fullName"
    ).lean();

    const mappedPosts = createdOrUpdatedPosts.map((post) => ({
      ...post,
      _id: post._id ? post._id.toString() : null,
      __localId: post.__localId ? post.__localId.toString() : null,
      location: post.location ? post.location.toString() : null,
      premise: post.premise ? post.premise.toString() : null,
      enclosure: post.enclosure ? post.enclosure.toString() : null,
      computer: post.computer ? post.computer.toString() : null,
      server: post.server ? post.server.toString() : null,
      ups: post.ups ? post.ups.toString() : null,
      user: post.user
        ? post.user._id
          ? post.user._id.toString()
          : post.user.toString()
        : null,
    }));

    const deletedPosts = await PostModel.find(
      {
        isPendingDeletion: true,
        updatedAt: { $gte: since },
      },
      "__localId"
    ).lean();

    const deletedLocalIds = deletedPosts
      .map((doc) => doc.__localId?.toString())
      .filter(Boolean);

    res.json({
      createdOrUpdatedPosts: mappedPosts,
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

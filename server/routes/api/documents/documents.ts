/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable object-shorthand */
import fs from "fs-extra";
import invariant from "invariant";
import Router from "koa-router";
import { pick } from "lodash";
import mime from "mime-types";
import { Op, ScopeOptions, WhereOptions } from "sequelize";
import { TeamPreference } from "@shared/types";
import { subtractDate } from "@shared/utils/date";
import { bytesToHumanReadable } from "@shared/utils/files";
import documentCreator from "@server/commands/documentCreator";
import documentImporter from "@server/commands/documentImporter";
import documentLoader from "@server/commands/documentLoader";
import documentMover from "@server/commands/documentMover";
import documentPermanentDeleter from "@server/commands/documentPermanentDeleter";
import documentUpdater from "@server/commands/documentUpdater";
import { sequelize } from "@server/database/sequelize";
import {
  NotFoundError,
  InvalidRequestError,
  AuthenticationError,
  ValidationError,
  IncorrectEditionError,
} from "@server/errors";
import auth from "@server/middlewares/authentication";
import { rateLimiter } from "@server/middlewares/rateLimiter";
import validate from "@server/middlewares/validate";
import {
  Backlink,
  Collection,
  Document,
  Event,
  Revision,
  SearchQuery,
  User,
  View,
  DocumentUser,
  DocumentInit,
  CollectionUser,
  DocumentGroup,
  Group,
  CollectionGroup,
} from "@server/models";
import DocumentHelper from "@server/models/helpers/DocumentHelper";
import SearchHelper from "@server/models/helpers/SearchHelper";
import { authorize, cannot } from "@server/policies";
import {
  presentCollection,
  presentDocument,
  presentPolicies,
} from "@server/presenters";
import { APIContext } from "@server/types";
import { RateLimiterStrategy } from "@server/utils/RateLimiter";
import { getTeamFromContext } from "@server/utils/passport";
import slugify from "@server/utils/slugify";
import { assertPresent, assertDocumentPermission } from "@server/validation";
import env from "../../../env";
import pagination from "../middlewares/pagination";
import * as T from "./schema";
// import { readRelativePosition } from "yjs/dist/src/internals";
// import { UserValidation } from "@shared/validations";
// import { ok } from "assert";
// import { logger } from "@sentry/utils";

const router = new Router();

router.post(
  "documents.list",
  auth(),
  pagination(),
  validate(T.DocumentsListSchema),
  async (ctx: APIContext<T.DocumentsListReq>) => {
    let { sort } = ctx.input.body;
    const {
      direction,
      template,
      collectionId,
      backlinkDocumentId,
      parentDocumentId,
      userId: createdById,
    } = ctx.input.body;

    // always filter by the current team
    const { user } = ctx.state.auth;
    let where: WhereOptions<Document> = {
      teamId: user.teamId,
      archivedAt: {
        [Op.is]: null,
      },
    };

    if (template) {
      where = { ...where, template: true };
    }

    // if a specific user is passed then add to filters. If the user doesn't
    // exist in the team then nothing will be returned, so no need to check auth
    if (createdById) {
      where = { ...where, createdById };
    }

    let documentIds: string[] = [];

    // if a specific collection is passed then we need to check auth to view it
    if (collectionId) {
      where = { ...where, collectionId };
      const collection = await Collection.scope({
        method: ["withMembership", user.id],
      }).findByPk(collectionId);
      authorize(user, "read", collection);

      // index sort is special because it uses the order of the documents in the
      // collection.documentStructure rather than a database column
      if (sort === "index") {
        documentIds = (collection?.documentStructure || [])
          .map((node) => node.id)
          .slice(ctx.state.pagination.offset, ctx.state.pagination.limit);
        where = { ...where, id: documentIds };
      } // otherwise, filter by all collections the user has access to
    } else {
      const collectionIds = await user.collectionIds();
      where = { ...where, collectionId: collectionIds };
    }

    if (parentDocumentId) {
      where = { ...where, parentDocumentId };
    }

    // Explicitly passing 'null' as the parentDocumentId allows listing documents
    // that have no parent document (aka they are at the root of the collection)
    if (parentDocumentId === null) {
      where = {
        ...where,
        parentDocumentId: {
          [Op.is]: null,
        },
      };
    }

    if (backlinkDocumentId) {
      const backlinks = await Backlink.findAll({
        attributes: ["reverseDocumentId"],
        where: {
          documentId: backlinkDocumentId,
        },
      });
      where = {
        ...where,
        id: backlinks.map((backlink) => backlink.reverseDocumentId),
      };
    }

    if (sort === "index") {
      sort = "updatedAt";
    }
    console.log(where);
    const documents = await Document.defaultScopeWithUser(user.id).findAll({
      where,
      order: [[sort, direction]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });

    // index sort is special because it uses the order of the documents in the
    // collection.documentStructure rather than a database column
    if (documentIds.length) {
      documents.sort(
        (a, b) => documentIds.indexOf(a.id) - documentIds.indexOf(b.id)
      );
    }

    const data = await Promise.all(
      documents.map((document) => presentDocument(document))
    );
    const policies = presentPolicies(user, documents);
    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.listV2",
  auth(),
  pagination(),
  validate(T.DocumentsListSchema),
  async (ctx: APIContext<T.DocumentsListReq>) => {
    let { sort } = ctx.input.body;
    const {
      direction,
      template,
      collectionId,
      backlinkDocumentId,
      parentDocumentId,
      userId: createdById,
    } = ctx.input.body;

    // always filter by the current team
    const { user } = ctx.state.auth;

    let where: WhereOptions<Document> = {
      teamId: user.teamId,
      archivedAt: {
        [Op.is]: null,
      },
    };

    if (template) {
      where = { ...where, template: true };
    }

    // if a specific user is passed then add to filters. If the user doesn't
    // exist in the team then nothing will be returned, so no need to check auth
    if (createdById) {
      where = { ...where, createdById };
    }

    const documentIds: string[] = [];

    // if a specific collection is passed then we need to check auth to view it
    if (collectionId) {
      where = { ...where, collectionId };
      const collection = await Collection.scope({
        method: ["withMembership", user.id],
      }).findByPk(collectionId);
      authorize(user, "read", collection);

      const documentIdUser = await DocumentUser.findAll({
        where: {
          collectionid: collectionId,
          userid: user.id,
        },
      });
      if (sort === "index") {
        const documentIds = documentIdUser
          .map((node) => node.documentid)
          .slice(ctx.state.pagination.offset, ctx.state.pagination.limit);
        console.log(documentIds);
        where = { ...where, id: documentIds };
      } // otherwise, filter by all collections the user has access to
    } else {
      const collectionIds = await user.collectionIds();
      where = { ...where, collectionId: collectionIds };
    }

    if (parentDocumentId) {
      where = { ...where, parentDocumentId };
    }

    // Explicitly passing 'null' as the parentDocumentId allows listing documents
    // that have no parent document (aka they are at the root of the collection)
    if (parentDocumentId === null) {
      where = {
        ...where,
        parentDocumentId: {
          [Op.is]: null,
        },
      };
    }

    if (backlinkDocumentId) {
      const backlinks = await Backlink.findAll({
        attributes: ["reverseDocumentId"],
        where: {
          documentId: backlinkDocumentId,
        },
      });
      where = {
        ...where,
        id: backlinks.map((backlink) => backlink.reverseDocumentId),
      };
    }

    if (sort === "index") {
      sort = "updatedAt";
    }
    console.log(where);
    const documents = await Document.defaultScopeWithUser(user.id).findAll({
      where,
      order: [[sort, direction]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });

    // index sort is special because it uses the order of the documents in the
    // collection.documentStructure rather than a database column
    if (documentIds.length) {
      documents.sort(
        (a, b) => documentIds.indexOf(a.id) - documentIds.indexOf(b.id)
      );
    }

    const data = await Promise.all(
      documents.map((document) => presentDocument(document))
    );
    const policies = presentPolicies(user, documents);
    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.archived",
  auth({ member: true }),
  pagination(),
  validate(T.DocumentsArchivedSchema),
  async (ctx: APIContext<T.DocumentsArchivedReq>) => {
    const { sort, direction } = ctx.input.body;
    const { user } = ctx.state.auth;
    const collectionIds = await user.collectionIds();
    const collectionScope: Readonly<ScopeOptions> = {
      method: ["withCollectionPermissions", user.id],
    };
    const viewScope: Readonly<ScopeOptions> = {
      method: ["withViews", user.id],
    };
    const documents = await Document.scope([
      "defaultScope",
      collectionScope,
      viewScope,
    ]).findAll({
      where: {
        teamId: user.teamId,
        collectionId: collectionIds,
        archivedAt: {
          [Op.ne]: null,
        },
      },
      order: [[sort, direction]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });
    const data = await Promise.all(
      documents.map((document) => presentDocument(document))
    );
    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.deleted",
  auth({ member: true }),
  pagination(),
  validate(T.DocumentsDeletedSchema),
  async (ctx: APIContext<T.DocumentsDeletedReq>) => {
    const { sort, direction } = ctx.input.body;
    const { user } = ctx.state.auth;
    const collectionIds = await user.collectionIds({
      paranoid: false,
    });
    const collectionScope: Readonly<ScopeOptions> = {
      method: ["withCollectionPermissions", user.id],
    };
    const viewScope: Readonly<ScopeOptions> = {
      method: ["withViews", user.id],
    };
    const documents = await Document.scope([
      collectionScope,
      viewScope,
    ]).findAll({
      where: {
        teamId: user.teamId,
        collectionId: {
          [Op.or]: [{ [Op.in]: collectionIds }, { [Op.is]: null }],
        },
        deletedAt: {
          [Op.ne]: null,
        },
      },
      include: [
        {
          model: User,
          as: "createdBy",
          paranoid: false,
        },
        {
          model: User,
          as: "updatedBy",
          paranoid: false,
        },
      ],
      paranoid: false,
      order: [[sort, direction]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });
    const data = await Promise.all(
      documents.map((document) => presentDocument(document))
    );
    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.viewed",
  auth(),
  pagination(),
  validate(T.DocumentsViewedSchema),
  async (ctx: APIContext<T.DocumentsViewedReq>) => {
    const { sort, direction } = ctx.input.body;
    const { user } = ctx.state.auth;
    const collectionIds = await user.collectionIds();
    const userId = user.id;
    const views = await View.findAll({
      where: {
        userId,
      },
      order: [[sort, direction]],
      include: [
        {
          model: Document,
          required: true,
          where: {
            collectionId: collectionIds,
          },
          include: [
            {
              model: Collection.scope({
                method: ["withMembership", userId],
              }),
              as: "collection",
            },
          ],
        },
      ],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });
    const documents = views.map((view) => {
      const document = view.document;
      document.views = [view];
      return document;
    });
    const data = await Promise.all(
      documents.map((document) => presentDocument(document))
    );
    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.drafts",
  auth(),
  pagination(),
  validate(T.DocumentsDraftsSchema),
  async (ctx: APIContext<T.DocumentsDraftsReq>) => {
    const { collectionId, dateFilter, direction, sort } = ctx.input.body;
    const { user } = ctx.state.auth;

    if (collectionId) {
      const collection = await Collection.scope({
        method: ["withMembership", user.id],
      }).findByPk(collectionId);
      authorize(user, "read", collection);
    }

    const collectionIds = collectionId
      ? [collectionId]
      : await user.collectionIds();
    const where: WhereOptions = {
      createdById: user.id,
      collectionId: {
        [Op.or]: [{ [Op.in]: collectionIds }, { [Op.is]: null }],
      },
      publishedAt: {
        [Op.is]: null,
      },
    };

    if (dateFilter) {
      where.updatedAt = {
        [Op.gte]: subtractDate(new Date(), dateFilter),
      };
    } else {
      delete where.updatedAt;
    }

    const collectionScope: Readonly<ScopeOptions> = {
      method: ["withCollectionPermissions", user.id],
    };
    const documents = await Document.scope([
      "defaultScope",
      collectionScope,
    ]).findAll({
      where,
      order: [[sort, direction]],
      offset: ctx.state.pagination.offset,
      limit: ctx.state.pagination.limit,
    });
    const data = await Promise.all(
      documents.map((document) => presentDocument(document))
    );
    const policies = presentPolicies(user, documents);

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.info",
  auth({
    optional: true,
  }),
  validate(T.DocumentsInfoSchema),
  async (ctx: APIContext<T.DocumentsInfoReq>) => {
    const { id, shareId, apiVersion } = ctx.input.body;
    const { user } = ctx.state.auth;
    const teamFromCtx = await getTeamFromContext(ctx);
    const { document, share, collection } = await documentLoader({
      id,
      shareId,
      user,
      teamId: teamFromCtx?.id,
    });
    const isPublic = cannot(user, "read", document);
    const serializedDocument = await presentDocument(document, {
      isPublic,
    });

    const team = await document.$get("team");

    // Passing apiVersion=2 has a single effect, to change the response payload to
    // include top level keys for document, sharedTree, and team.
    const data =
      apiVersion === 2
        ? {
            document: serializedDocument,
            team: team?.getPreference(TeamPreference.PublicBranding)
              ? pick(team, ["avatarUrl", "name"])
              : undefined,
            sharedTree:
              share && share.includeChildDocuments
                ? collection?.getDocumentTree(share.documentId)
                : undefined,
          }
        : serializedDocument;
    ctx.body = {
      data,
      policies: isPublic ? undefined : presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.export",
  rateLimiter(RateLimiterStrategy.FivePerMinute),
  auth({
    optional: true,
  }),
  validate(T.DocumentsExportSchema),
  async (ctx: APIContext<T.DocumentsExportReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;
    const accept = ctx.request.headers["accept"];

    const { document } = await documentLoader({
      id,
      user,
      // We need the collaborative state to generate HTML.
      includeState: !accept?.includes("text/markdown"),
    });

    let contentType;
    let content;

    if (accept?.includes("text/html")) {
      contentType = "text/html";
      content = await DocumentHelper.toHTML(document, {
        signedUrls: true,
        centered: true,
      });
    } else if (accept?.includes("application/pdf")) {
      throw IncorrectEditionError(
        "PDF export is not available in the community edition"
      );
    } else if (accept?.includes("text/markdown")) {
      contentType = "text/markdown";
      content = DocumentHelper.toMarkdown(document);
    } else {
      contentType = "application/json";
      content = DocumentHelper.toMarkdown(document);
    }

    if (contentType !== "application/json") {
      ctx.set("Content-Type", contentType);
      ctx.set(
        "Content-Disposition",
        `attachment; filename="${slugify(
          document.titleWithDefault
        )}.${mime.extension(contentType)}"`
      );
      ctx.body = content;
      return;
    }

    ctx.body = {
      data: content,
    };
  }
);

router.post(
  "documents.restore",
  auth({ member: true }),
  validate(T.DocumentsRestoreSchema),
  async (ctx: APIContext<T.DocumentsRestoreReq>) => {
    const { id, collectionId, revisionId } = ctx.input.body;
    const { user } = ctx.state.auth;
    const document = await Document.findByPk(id, {
      userId: user.id,
      paranoid: false,
    });

    if (!document) {
      throw NotFoundError();
    }

    // Passing collectionId allows restoring to a different collection than the
    // document was originally within
    if (collectionId) {
      document.collectionId = collectionId;
    }

    const collection = await Collection.scope({
      method: ["withMembership", user.id],
    }).findByPk(document.collectionId);

    // if the collectionId was provided in the request and isn't valid then it will
    // be caught as a 403 on the authorize call below. Otherwise we're checking here
    // that the original collection still exists and advising to pass collectionId
    // if not.
    if (document.collection && !collectionId && !collection) {
      throw ValidationError(
        "Unable to restore to original collection, it may have been deleted"
      );
    }

    if (document.collection) {
      authorize(user, "update", collection);
    }

    if (document.deletedAt) {
      authorize(user, "restore", document);
      // restore a previously deleted document
      await document.unarchive(user.id);
      await Event.create({
        name: "documents.restore",
        documentId: document.id,
        collectionId: document.collectionId,
        teamId: document.teamId,
        actorId: user.id,
        data: {
          title: document.title,
        },
        ip: ctx.request.ip,
      });
    } else if (document.archivedAt) {
      authorize(user, "unarchive", document);
      // restore a previously archived document
      await document.unarchive(user.id);
      await Event.create({
        name: "documents.unarchive",
        documentId: document.id,
        collectionId: document.collectionId,
        teamId: document.teamId,
        actorId: user.id,
        data: {
          title: document.title,
        },
        ip: ctx.request.ip,
      });
    } else if (revisionId) {
      // restore a document to a specific revision
      authorize(user, "update", document);
      const revision = await Revision.findByPk(revisionId);

      authorize(document, "restore", revision);

      document.text = revision.text;
      document.title = revision.title;
      await document.save();
      await Event.create({
        name: "documents.restore",
        documentId: document.id,
        collectionId: document.collectionId,
        teamId: document.teamId,
        actorId: user.id,
        data: {
          title: document.title,
        },
        ip: ctx.request.ip,
      });
    } else {
      assertPresent(revisionId, "revisionId is required");
    }

    ctx.body = {
      data: await presentDocument(document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.search_titles",
  auth(),
  pagination(),
  validate(T.DocumentsSearchSchema),
  async (ctx: APIContext<T.DocumentsSearchReq>) => {
    const {
      query,
      includeArchived,
      includeDrafts,
      dateFilter,
      collectionId,
      userId,
    } = ctx.input.body;
    const { offset, limit } = ctx.state.pagination;
    const { user } = ctx.state.auth;
    let collaboratorIds = undefined;

    if (collectionId) {
      const collection = await Collection.scope({
        method: ["withMembership", user.id],
      }).findByPk(collectionId);
      authorize(user, "read", collection);
    }

    if (userId) {
      collaboratorIds = [userId];
    }

    const documents = await SearchHelper.searchTitlesForUser(user, query, {
      includeArchived,
      includeDrafts,
      dateFilter,
      collectionId,
      collaboratorIds,
      offset,
      limit,
    });
    const policies = presentPolicies(user, documents);
    const data = await Promise.all(
      documents.map((document) => presentDocument(document))
    );

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies,
    };
  }
);

router.post(
  "documents.search",
  auth({
    optional: true,
  }),
  pagination(),
  validate(T.DocumentsSearchSchema),
  async (ctx: APIContext<T.DocumentsSearchReq>) => {
    const {
      query,
      includeArchived,
      includeDrafts,
      collectionId,
      userId,
      dateFilter,
      shareId,
      snippetMinWords,
      snippetMaxWords,
    } = ctx.input.body;
    const { offset, limit } = ctx.state.pagination;

    // Unfortunately, this still doesn't adequately handle cases when auth is optional
    const { user } = ctx.state.auth;

    let teamId;
    let response;

    if (shareId) {
      const teamFromCtx = await getTeamFromContext(ctx);
      const { share, document } = await documentLoader({
        teamId: teamFromCtx?.id,
        shareId,
        user,
      });

      if (!share?.includeChildDocuments) {
        throw InvalidRequestError("Child documents cannot be searched");
      }

      teamId = share.teamId;
      const team = await share.$get("team");
      invariant(team, "Share must belong to a team");

      response = await SearchHelper.searchForTeam(team, query, {
        includeArchived,
        includeDrafts,
        collectionId: document.collectionId,
        share,
        dateFilter,
        offset,
        limit,
        snippetMinWords,
        snippetMaxWords,
      });
    } else {
      if (!user) {
        throw AuthenticationError("Authentication error");
      }

      teamId = user.teamId;

      if (collectionId) {
        const collection = await Collection.scope({
          method: ["withMembership", user.id],
        }).findByPk(collectionId);
        authorize(user, "read", collection);
      }

      let collaboratorIds = undefined;

      if (userId) {
        collaboratorIds = [userId];
      }

      response = await SearchHelper.searchForUser(user, query, {
        includeArchived,
        includeDrafts,
        collaboratorIds,
        collectionId,
        dateFilter,
        offset,
        limit,
        snippetMinWords,
        snippetMaxWords,
      });
    }

    const { results, totalCount } = response;
    const documents = results.map((result) => result.document);

    const data = await Promise.all(
      results.map(async (result) => {
        const document = await presentDocument(result.document);
        return { ...result, document };
      })
    );

    // When requesting subsequent pages of search results we don't want to record
    // duplicate search query records
    if (offset === 0) {
      SearchQuery.create({
        userId: user?.id,
        teamId,
        shareId,
        source: ctx.state.auth.type || "app", // we'll consider anything that isn't "api" to be "app"
        query,
        results: totalCount,
      });
    }

    ctx.body = {
      pagination: ctx.state.pagination,
      data,
      policies: user ? presentPolicies(user, documents) : null,
    };
  }
);

router.post(
  "documents.templatize",
  auth({ member: true }),
  validate(T.DocumentsTemplatizeSchema),
  async (ctx: APIContext<T.DocumentsTemplatizeReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const original = await Document.findByPk(id, {
      userId: user.id,
    });
    authorize(user, "update", original);

    const document = await Document.create({
      editorVersion: original.editorVersion,
      collectionId: original.collectionId,
      teamId: original.teamId,
      userId: user.id,
      publishedAt: new Date(),
      lastModifiedById: user.id,
      createdById: user.id,
      template: true,
      title: original.title,
      text: original.text,
    });
    await Event.create({
      name: "documents.create",
      documentId: document.id,
      collectionId: document.collectionId,
      teamId: document.teamId,
      actorId: user.id,
      data: {
        title: document.title,
        template: true,
      },
      ip: ctx.request.ip,
    });

    // reload to get all of the data needed to present (user, collection etc)
    const reloaded = await Document.findByPk(document.id, {
      userId: user.id,
    });
    invariant(reloaded, "document not found");

    ctx.body = {
      data: await presentDocument(reloaded),
      policies: presentPolicies(user, [reloaded]),
    };
  }
);

router.post(
  "documents.update",
  auth(),
  validate(T.DocumentsUpdateSchema),
  async (ctx: APIContext<T.DocumentsUpdateReq>) => {
    const {
      id,
      title,
      text,
      fullWidth,
      publish,
      lastRevision,
      templateId,
      collectionId,
      append,
      apiVersion,
    } = ctx.input.body;
    const editorVersion = ctx.headers["x-editor-version"] as string | undefined;
    const { user } = ctx.state.auth;
    let collection: Collection | null | undefined;

    const document = await Document.findByPk(id, {
      userId: user.id,
      includeState: true,
    });
    collection = document?.collection;
    authorize(user, "update", document);

    if (publish) {
      if (!document.collectionId) {
        assertPresent(
          collectionId,
          "collectionId is required to publish a draft without collection"
        );
        collection = await Collection.findByPk(collectionId as string);
      }
      authorize(user, "publish", collection);
    }

    if (lastRevision && lastRevision !== document.revisionCount) {
      throw InvalidRequestError("Document has changed since last revision");
    }

    collection = await sequelize.transaction(async (transaction) => {
      await documentUpdater({
        document,
        user,
        title,
        text,
        fullWidth,
        publish,
        collectionId,
        append,
        templateId,
        editorVersion,
        transaction,
        ip: ctx.request.ip,
      });

      return await Collection.scope({
        method: ["withMembership", user.id],
      }).findByPk(document.collectionId, { transaction });
    });

    document.updatedBy = user;
    document.collection = collection;

    ctx.body = {
      data:
        apiVersion === 2
          ? {
              document: await presentDocument(document),
              collection: collection
                ? presentCollection(collection)
                : undefined,
            }
          : await presentDocument(document),
      policies: presentPolicies(user, [document, collection]),
    };
  }
);

router.post(
  "documents.move",
  auth(),
  validate(T.DocumentsMoveSchema),
  async (ctx: APIContext<T.DocumentsMoveReq>) => {
    const { id, collectionId, parentDocumentId, index } = ctx.input.body;
    const { user } = ctx.state.auth;
    const document = await Document.findByPk(id, {
      userId: user.id,
    });
    authorize(user, "move", document);

    const collection = await Collection.scope({
      method: ["withMembership", user.id],
    }).findByPk(collectionId);
    authorize(user, "update", collection);

    if (parentDocumentId) {
      const parent = await Document.findByPk(parentDocumentId, {
        userId: user.id,
      });
      authorize(user, "update", parent);

      if (!parent.publishedAt) {
        throw InvalidRequestError("Cannot move document inside a draft");
      }
    }

    const {
      documents,
      collections,
      collectionChanged,
    } = await sequelize.transaction(async (transaction) =>
      documentMover({
        user,
        document,
        collectionId,
        parentDocumentId,
        index,
        ip: ctx.request.ip,
        transaction,
      })
    );

    ctx.body = {
      data: {
        documents: await Promise.all(
          documents.map((document) => presentDocument(document))
        ),
        collections: await Promise.all(
          collections.map((collection) => presentCollection(collection))
        ),
      },
      policies: collectionChanged ? presentPolicies(user, documents) : [],
    };
  }
);

router.post(
  "documents.add_group",
  auth(),
  validate(T.DocumentsAddGroup),
  async (ctx: APIContext) => {
    const { auth } = ctx.state;
    const actor = auth.user;
    const { id, groupId, documentId, permission } = ctx.request.body;

    // S1: Get CollectionID in Document database
    const documentInstance = await Document.findOne({
      where: {
        id: documentId,
      },
    });
    if (!documentInstance?.collectionId) {
      throw InvalidRequestError("Document not exist in Collection");
    }

    // S5: Check actor permission read_write in collections
    const checkActor = await CollectionUser.findOne({
      where: {
        userId: actor.id,
        permission: "read_write",
      },
    });
    if (!checkActor) {
      throw InvalidRequestError("Actor permission denied");
    }

    // S2: Check GroupId in Collection_group
    const GroupInstance = await CollectionGroup.findOne({
      where: {
        groupId: groupId,
        collectionId: documentInstance?.collectionId,
      },
    });
    if (!GroupInstance) {
      throw InvalidRequestError("Group not exist in Collection_Group");
    }

    // S3: Check GroupId exist in DocumentGroup ?
    const CheckGroupIdinDocGroup = await DocumentGroup.findOne({
      where: {
        groupid: groupId,
        documentid: documentId,
      },
    });
    if (CheckGroupIdinDocGroup) {
      throw InvalidRequestError("Group exist in Document_Group");
    } else {
      const groupMembership = DocumentGroup.create({
        id: id,
        groupid: groupId,
        documentid: documentId,
        permission: permission,
      });
    }

    ctx.body = {
      data: {
        actor: actor.id,
        permisson: permission,
        groupid: groupId,
      },
    };
  }
);

router.post(
  "documents.group_update_permission",
  auth(),
  validate(T.DocumentsAddGroup),
  async (ctx: APIContext) => {
    const { auth } = ctx.state;
    const actor = auth.user;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, groupId, documentId, permission } = ctx.request.body;

    // S3: Check GroupId exist in DocumentGroup ?
    const CheckGroupIdinDocGroup = await DocumentGroup.findOne({
      where: {
        groupid: groupId,
        documentid: documentId,
      },
    });

    // S5: Check actor permission read_write in collections
    const checkActor = await CollectionUser.findOne({
      where: {
        userId: actor.id,
        permission: "read_write",
      },
    });
    if (!checkActor) {
      throw InvalidRequestError("Actor permission denied");
    }

    if (permission) {
      assertDocumentPermission(permission);
    }
    if (!CheckGroupIdinDocGroup) {
      throw InvalidRequestError("UserId not exsist in documentUser");
    } else if (CheckGroupIdinDocGroup.permission !== permission) {
      // CheckGroupIdinDocGroup.permission = permission;
      await DocumentGroup.update(
        { permission: permission },
        {
          where: {
            groupid: groupId,
            documentid: documentId,
          },
        }
      );
    } else {
      throw InvalidRequestError(
        "Type of perrmission must be read or read_write"
      );
    }
    ctx.body = {
      data: {
        actor: actor.id,
        group: groupId,
        permisson: permission,
      },
    };
  }
);

router.post(
  "documents.remove_group",
  auth(),
  validate(T.DocumentsAddGroup),
  async (ctx: APIContext) => {
    const { auth } = ctx.state;
    const actor = auth.user;
    const { id, groupId, documentId, permission } = ctx.request.body;

    // S1: Check user exist in DocumentUser ?
    const CheckGroupExist = await DocumentGroup.findOne({
      where: {
        groupid: groupId,
        documentid: documentId,
      },
    });

    // S5: Check actor permission read_write in collections
    const checkActor = await CollectionUser.findOne({
      where: {
        userId: actor.id,
        permission: "read_write",
      },
    });
    if (!checkActor) {
      throw InvalidRequestError("Actor permission denied");
    }

    const CountUser = await DocumentGroup.count({
      where: {
        groupid: groupId,
        documentid: documentId,
      },
    });
    if (!CheckGroupExist) {
      throw InvalidRequestError(
        "Group and document not exsist in documentGroup"
      );
    } else {
      DocumentGroup.destroy({
        where: {
          groupid: groupId,
          documentid: documentId,
        },
      });
    }

    ctx.body = {
      data: {
        CountUser: CountUser,
        success: "ok",
      },
    };
  }
);

router.post(
  "documents.add_user",
  auth(),
  validate(T.DocumentsAddUser),
  async (ctx: APIContext) => {
    const { auth } = ctx.state;
    const actor = auth.user;
    const { id, userId, documentId, permission } = ctx.request.body;

    // S1: Check ACTOR === createdById ?
    if (actor.id === userId) {
      throw InvalidRequestError("You cant add yourself");
    }

    // S5: Check actor permission read_write in collections
    const checkActor = await CollectionUser.findOne({
      where: {
        userId: actor.id,
        permission: "read_write",
      },
    });
    if (!checkActor) {
      throw InvalidRequestError("Actor permission denied");
    }

    // S4: Get CollectionID in Document database
    const documentInstance = await Document.findOne({
      where: {
        id: documentId,
      },
    });
    if (!documentInstance?.collectionId) {
      throw InvalidRequestError("Document not exist in Collection");
    }

    // S2: Check user exist in CollectionUser ?
    const CheckUserIDinColUser = await CollectionUser.findOne({
      where: {
        userId: userId,
        collectionId: documentInstance?.collectionId,
      },
    });
    if (!CheckUserIDinColUser) {
      throw InvalidRequestError("User not in CollectionUser");
    }

    // S3: Check user exist in DocumentUser ?
    const CheckUserIDinDocUser = await DocumentUser.findOne({
      where: {
        userid: userId,
        documentid: documentId,
      },
    });
    if (CheckUserIDinDocUser) {
      throw InvalidRequestError("UserId exsist in documentUser");
    }

    if (!CheckUserIDinDocUser) {
      const membership = await DocumentUser.create({
        id: id,
        userid: userId,
        documentid: documentId,
        permission: permission,
      });
    }

    ctx.body = {
      data: {
        actor: actor.id,
        users: userId,
        permisson: permission,
      },
    };
  }
);

router.post(
  "documents.add_userV2",
  auth(),
  validate(T.DocumentsAddUser),
  async (ctx: APIContext) => {
    const { auth } = ctx.state;
    const actor = auth.user;
    const { userData } = ctx.request.body;
    // const { user } = ctx.state.auth;

    if (userData.length === 0) {
      throw InvalidRequestError("userData is not a array");
    }
    if (!userData) {
      throw InvalidRequestError("userData is empty");
      1;
    }

    // S1: Check actor permission read_write in collections
    const checkActor = await CollectionUser.findOne({
      where: {
        userId: actor.id,
        permission: "read_write",
      },
    });
    if (!checkActor) {
      throw InvalidRequestError("Actor permission denied");
    }

    for (let i = 0; i < userData.length; i++) {
      // S2: Get CollectionID in Document database
      const documentInstance = await Document.findOne({
        where: {
          id: userData[i].documentId,
        },
      });
      if (!documentInstance?.collectionId) {
        throw InvalidRequestError("Document not exist in Collection");
      }

      // S3: Check user exist in CollectionUser ?
      const CheckUserIDinColUser = await CollectionUser.findOne({
        where: {
          userId: userData[i].userId,
          collectionId: documentInstance?.collectionId,
        },
      });
      if (!CheckUserIDinColUser) {
        throw InvalidRequestError("User not in CollectionUser");
      }

      // S4: Check user exist in DocumentUser ?
      const CheckUserIDinDocUser = await DocumentUser.findOne({
        where: {
          userid: userData[i].userId,
          documentid: userData[i].documentId,
        },
      });
      if (CheckUserIDinDocUser) {
        throw InvalidRequestError("UserId exsist in documentUser");
      }

      const membership = await DocumentUser.create({
        id: userData[i].Id,
        userid: userData[i].userId,
        documentid: userData[i].documentId,
        collectionid: documentInstance?.collectionId,
      });
    }

    ctx.body = {
      data: {
        metadata: userData,
      },
    };
  }
);

router.post(
  "documents.init_user",
  auth(),
  // validate(T.DocumentsAddUser),
  async (ctx: APIContext) => {
    const { auth } = ctx.state;
    const actor = auth.user;
    const { userId, documentId, permission, collectionId } = ctx.request.body;

    console.log(userId);
    console.log(documentId);
    console.log(permission);
    console.log(collectionId);
    // S1: Check init exist
    const checkInit = await DocumentInit.findOne({
      where: {
        collectionId,
      },
    });
    if (checkInit?.isUpdated) {
      return;
    }
    if (!checkInit?.isUpdated) {
      // S2: Check userId exist in CollectionUser
      for (let i = 0; i < userId.length; i++) {
        const checkUserId = await CollectionUser.findOne({
          where: {
            userId: userId[i],
            collectionId,
          },
        });
        console.log(checkUserId);
        if (!checkUserId) {
          throw InvalidRequestError("UserId is not exist in collection User");
        }
      }

      // S3: Check documentId exist in Document
      for (let i = 0; i < documentId.length; i++) {
        const checkDocumentId = await Document.findOne({
          where: {
            collectionId,
            id: documentId[i],
          },
        });
        if (!checkDocumentId) {
          throw InvalidRequestError("DocumentId is not exist in Document");
        }
      }

      const documentUserInstance = [];
      for (let i = 0; i < userId.length; i++) {
        for (let j = 0; j < documentId.length; j++) {
          const dataUser = {
            userId: userId[i],
            documentId: documentId[j],
          };
          documentUserInstance.push(dataUser);
        }
      }

      for (let i = 0; i < documentUserInstance.length; i++) {
        const membership = await DocumentUser.create({
          id: documentUserInstance[i].userId,
          userid: documentUserInstance[i].userId,
          documentid: documentUserInstance[i].documentId,
          collectionid: collectionId,
          permission: permission,
        });
      }
      const createInit = await DocumentInit.create({
        collectionId,
        isUpdated: true,
      });
      ctx.body = {
        data: {
          message: "oke",
        },
      };
    } else {
      ctx.body = {
        data: {
          message: "Collection is inited!",
        },
      };
    }
  }
);

router.post(
  "documents.update_permission",
  auth(),
  validate(T.DocumentsAddUser),
  async (ctx: APIContext) => {
    const { auth } = ctx.state;
    const actor = auth.user;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, userId, documentId, permission } = ctx.request.body;

    // S5: Check actor permission read_write in collections
    const checkActor = await CollectionUser.findOne({
      where: {
        userId: actor.id,
        permission: "read_write",
      },
    });
    if (!checkActor) {
      throw InvalidRequestError("Actor permission denied");
    }

    const CheckRemoveUser = await DocumentUser.findOne({
      where: {
        userid: userId,
        documentid: documentId,
      },
    });
    if (permission) {
      assertDocumentPermission(permission);
    }
    if (!CheckRemoveUser) {
      throw InvalidRequestError("UserId not exsist in documentUser");
    } else if (CheckRemoveUser.permission !== permission) {
      // CheckRemoveUser.permission = permission;
      await DocumentUser.update(
        { permission: permission },
        {
          where: {
            userid: userId,
            documentid: documentId,
          },
        }
      );
    } else {
      throw InvalidRequestError(
        "Type of perrmission must be read or read_write"
      );
    }
    ctx.body = {
      data: {
        success: true,
      },
    };
  }
);

router.post(
  "documents.remove_user",
  auth(),
  validate(T.DocumentsAddUser),
  async (ctx: APIContext) => {
    const { auth } = ctx.state;
    const actor = auth.user;
    const { userId, documentId } = ctx.request.body;

    // S1: Check user exist in DocumentUser ?
    const CheckUserExist = await DocumentUser.findOne({
      where: {
        userid: userId,
        documentid: documentId,
      },
    });

    // S5: Check actor permission read_write in collections
    const checkActor = await CollectionUser.findOne({
      where: {
        userId: actor.id,
        permission: "read_write",
      },
    });
    if (!checkActor) {
      throw InvalidRequestError("Actor permission denied");
    }

    const CountUser = await DocumentUser.count({
      where: {
        userid: userId,
        documentid: documentId,
      },
    });
    if (!CheckUserExist) {
      throw InvalidRequestError("user and document not exsist in documentUser");
    } else {
      DocumentUser.destroy({
        where: {
          userid: userId,
          documentid: documentId,
        },
      });
    }

    ctx.body = {
      data: {
        success: true,
      },
    };
  }
);

router.post("documents.user", auth(), async (ctx: APIContext) => {
  const { auth } = ctx.state;
  const actor = auth.user;

  // S1: Check actor permission read_write in collections
  const checkActor = await CollectionUser.findOne({
    where: {
      userId: actor.id,
      permission: "read_write",
    },
  });
  if (!checkActor) {
    throw InvalidRequestError("Actor permission denied");
  }

  // S2: Return data from DocumentUser
  const userDocument = await DocumentUser.findAll();
  if (!userDocument) {
    throw InvalidRequestError("Database is empty!");
  }
  ctx.body = {
    data: {
      success: userDocument,
    },
  };
});

router.post("documents.group", auth(), async (ctx: APIContext) => {
  const { auth } = ctx.state;
  const actor = auth.user;

  // S1: Check actor permission read_write in collections
  const checkActor = await CollectionUser.findOne({
    where: {
      userId: actor.id,
      permission: "read_write",
    },
  });
  if (!checkActor) {
    throw InvalidRequestError("Actor permission denied");
  }

  // S2: Return data from DocumentUser
  const groupDocument = await DocumentGroup.findAll();
  if (!groupDocument) {
    throw InvalidRequestError("Database is empty!");
  }
  ctx.body = {
    data: {
      success: groupDocument,
    },
  };
});

router.post(
  "documents.archive",
  auth(),
  validate(T.DocumentsArchiveSchema),
  async (ctx: APIContext<T.DocumentsArchiveReq>) => {
    const { id } = ctx.input.body;
    const { user } = ctx.state.auth;

    const document = await Document.findByPk(id, {
      userId: user.id,
    });
    authorize(user, "archive", document);

    await document.archive(user.id);
    await Event.create({
      name: "documents.archive",
      documentId: document.id,
      collectionId: document.collectionId,
      teamId: document.teamId,
      actorId: user.id,
      data: {
        title: document.title,
      },
      ip: ctx.request.ip,
    });

    ctx.body = {
      data: await presentDocument(document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.delete",
  auth(),
  validate(T.DocumentsDeleteSchema),
  async (ctx: APIContext<T.DocumentsDeleteReq>) => {
    const { id, permanent } = ctx.input.body;
    const { user } = ctx.state.auth;

    if (permanent) {
      const document = await Document.findByPk(id, {
        userId: user.id,
        paranoid: false,
      });
      authorize(user, "permanentDelete", document);

      await Document.update(
        {
          parentDocumentId: null,
        },
        {
          where: {
            parentDocumentId: document.id,
          },
          paranoid: false,
        }
      );
      await documentPermanentDeleter([document]);
      await Event.create({
        name: "documents.permanent_delete",
        documentId: document.id,
        collectionId: document.collectionId,
        teamId: document.teamId,
        actorId: user.id,
        data: {
          title: document.title,
        },
        ip: ctx.request.ip,
      });
    } else {
      const document = await Document.findByPk(id, {
        userId: user.id,
      });

      authorize(user, "delete", document);

      await document.delete(user.id);
      await Event.create({
        name: "documents.delete",
        documentId: document.id,
        collectionId: document.collectionId,
        teamId: document.teamId,
        actorId: user.id,
        data: {
          title: document.title,
        },
        ip: ctx.request.ip,
      });
    }

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "documents.delete",
  auth(),
  validate(T.DocumentsDeleteSchema),
  async (ctx: APIContext<T.DocumentsDeleteReq>) => {
    const { id, permanent } = ctx.input.body;
    const { user } = ctx.state.auth;

    if (permanent) {
      const document = await Document.findByPk(id, {
        userId: user.id,
        paranoid: false,
      });
      authorize(user, "permanentDelete", document);

      await Document.update(
        {
          parentDocumentId: null,
        },
        {
          where: {
            parentDocumentId: document.id,
          },
          paranoid: false,
        }
      );
      await documentPermanentDeleter([document]);
      await Event.create({
        name: "documents.permanent_delete",
        documentId: document.id,
        collectionId: document.collectionId,
        teamId: document.teamId,
        actorId: user.id,
        data: {
          title: document.title,
        },
        ip: ctx.request.ip,
      });
    } else {
      const document = await Document.findByPk(id, {
        userId: user.id,
      });

      authorize(user, "delete", document);

      await document.delete(user.id);
      await Event.create({
        name: "documents.delete",
        documentId: document.id,
        collectionId: document.collectionId,
        teamId: document.teamId,
        actorId: user.id,
        data: {
          title: document.title,
        },
        ip: ctx.request.ip,
      });
    }

    ctx.body = {
      success: true,
    };
  }
);

router.post(
  "documents.unpublish",
  auth(),
  validate(T.DocumentsUnpublishSchema),
  async (ctx: APIContext<T.DocumentsUnpublishReq>) => {
    const { id, apiVersion } = ctx.input.body;
    const { user } = ctx.state.auth;

    const document = await Document.findByPk(id, {
      userId: user.id,
    });
    authorize(user, "unpublish", document);

    const childDocumentIds = await document.getChildDocumentIds();
    if (childDocumentIds.length > 0) {
      throw InvalidRequestError(
        "Cannot unpublish document with child documents"
      );
    }

    await document.unpublish(user.id);
    await Event.create({
      name: "documents.unpublish",
      documentId: document.id,
      collectionId: document.collectionId,
      teamId: document.teamId,
      actorId: user.id,
      data: {
        title: document.title,
      },
      ip: ctx.request.ip,
    });

    ctx.body = {
      data:
        apiVersion === 2
          ? {
              document: await presentDocument(document),
              collection: document.collection
                ? presentCollection(document.collection)
                : undefined,
            }
          : await presentDocument(document),
      policies: presentPolicies(user, [document]),
    };
  }
);

router.post(
  "documents.import",
  auth(),
  validate(T.DocumentsImportSchema),
  async (ctx: APIContext<T.DocumentsImportReq>) => {
    if (!ctx.is("multipart/form-data")) {
      throw InvalidRequestError("Request type must be multipart/form-data");
    }

    const { collectionId, parentDocumentId, publish } = ctx.input.body;

    const file = ctx.request.files
      ? Object.values(ctx.request.files)[0]
      : undefined;
    if (!file) {
      throw InvalidRequestError("Request must include a file parameter");
    }

    if (env.MAXIMUM_IMPORT_SIZE && file.size > env.MAXIMUM_IMPORT_SIZE) {
      throw InvalidRequestError(
        `The selected file was larger than the ${bytesToHumanReadable(
          env.MAXIMUM_IMPORT_SIZE
        )} maximum size`
      );
    }

    const { user } = ctx.state.auth;

    const collection = await Collection.scope({
      method: ["withMembership", user.id],
    }).findOne({
      where: {
        id: collectionId,
        teamId: user.teamId,
      },
    });
    authorize(user, "publish", collection);
    let parentDocument;

    if (parentDocumentId) {
      parentDocument = await Document.findOne({
        where: {
          id: parentDocumentId,
          collectionId: collection.id,
        },
      });
      authorize(user, "read", parentDocument, {
        collection,
      });
    }

    const content = await fs.readFile(file.path);
    const document = await sequelize.transaction(async (transaction) => {
      const { text, title } = await documentImporter({
        user,
        fileName: file.name,
        mimeType: file.type,
        content,
        ip: ctx.request.ip,
        transaction,
      });

      return documentCreator({
        source: "import",
        title,
        text,
        publish,
        collectionId,
        parentDocumentId,
        user,
        ip: ctx.request.ip,
        transaction,
      });
    });

    document.collection = collection;

    return (ctx.body = {
      data: await presentDocument(document),
      policies: presentPolicies(user, [document]),
    });
  }
);

router.post(
  "documents.create",
  auth(),
  validate(T.DocumentsCreateSchema),
  async (ctx: APIContext<T.DocumentsCreateReq>) => {
    const {
      title = "",
      text = "",
      publish,
      collectionId,
      parentDocumentId,
      templateId,
      template,
    } = ctx.input.body;
    const editorVersion = ctx.headers["x-editor-version"] as string | undefined;

    const { user } = ctx.state.auth;

    let collection;

    if (collectionId) {
      collection = await Collection.scope({
        method: ["withMembership", user.id],
      }).findOne({
        where: {
          id: collectionId,
          teamId: user.teamId,
        },
      });
      authorize(user, "publish", collection);
    }

    let parentDocument;

    if (parentDocumentId) {
      parentDocument = await Document.findOne({
        where: {
          id: parentDocumentId,
          collectionId: collection?.id,
        },
      });
      authorize(user, "read", parentDocument, {
        collection,
      });
    }

    let templateDocument: Document | null | undefined;

    if (templateId) {
      templateDocument = await Document.findByPk(templateId, {
        userId: user.id,
      });
      authorize(user, "read", templateDocument);
    }

    const document = await sequelize.transaction(async (transaction) => {
      return documentCreator({
        title,
        text,
        publish,
        collectionId,
        parentDocumentId,
        templateDocument,
        template,
        user,
        editorVersion,
        ip: ctx.request.ip,
        transaction,
      });
    });

    document.collection = collection;

    return (ctx.body = {
      data: await presentDocument(document),
      policies: presentPolicies(user, [document]),
    });
  }
);

export default router;

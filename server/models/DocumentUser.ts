import {
  Column,
  ForeignKey,
  BelongsTo,
  Default,
  IsIn,
  Table,
  DataType,
  Scopes,
} from "sequelize-typescript";
import { DocumentPermission } from "@shared/types";
import Document from "./Document";
import User from "./User";
import BaseModel from "./base/BaseModel";
import ParanoidModel from "./base/ParanoidModel";
import Fix from "./decorators/Fix";

@Scopes(() => ({
  withUser: {
    include: [
      {
        association: "user",
      },
    ],
  },
  withCollection: {
    include: [
      {
        association: "collection",
      },
    ],
  },
}))
@Table({ tableName: "document_user", modelName: "document_user" })
@Fix
class DocumentUser extends BaseModel {
  @Default(DocumentPermission.ReadWrite)
  @IsIn([Object.values(DocumentPermission)])
  @Column(DataType.STRING)
  permission: DocumentPermission;

  @Column(DataType.UUID)
  documentid: string;

  @Column(DataType.UUID)
  collectionid: string;

  @Column(DataType.UUID)
  userid: string;

  @Column(DataType.UUID)
  createdbyid: string;
}

export default DocumentUser;

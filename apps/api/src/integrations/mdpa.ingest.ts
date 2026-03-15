import * as crypto from "crypto";
import * as fs from "fs";
import { Injectable } from "@nestjs/common";
import { RollStage } from "@prisma/client";
import { parse as parseSync } from "csv-parse/sync";
import { PrismaService } from "../shared/prisma.service";
import { computeScore } from "../scoring/score";
import { geocodeAddress } from "./geocoding";

export type MdpaDatasetType =
  | "MUNICIPAL_ROLLS"
  | "SALES_INFO"
  | "ROLL_EVENTS"
  | "PROPERTY_INFO"
  | "SPECIAL_REQUEST"
  | "GENERIC";

export interface MdpaIngestOptions {
  maxRows?: number;
  datasetType?: MdpaDatasetType;
  sourceUrl?: string;
  snapshotDate?: Date;
  library?: string;
}

export interface IngestResult {
  processed: number;
  skipped: number;
  createdDeals: number;
  updatedDeals: number;
  createdOwners: number;
  linkedOwners: number;
  createdSales: number;
  createdAssessments: number;
  createdRollEvents: number;
  snapshotId: string;
  datasetType: MdpaDatasetType;
}

const HEADER_MAP: Record<string, string[]> = {
  parcelId: ["FOLIO", "PARCEL", "PARCEL_ID", "PARID", "PARCEL_NO", "PARCELNO"],
  address: ["SITE_ADDR", "SITE_ADDRESS", "PROPERTY_ADDRESS", "SITUS_ADDRESS", "ADDRESS"],
  mailingAddress: [
    "MAIL_ADDR",
    "MAILING_ADDRESS",
    "OWNER_MAILING_ADDRESS",
    "OWNER_ADDRESS",
    "MAILADDRESS",
  ],
  city: ["SITUS_CITY", "CITY"],
  municipality: ["MUNICIPALITY", "CITY"],
  state: ["SITUS_STATE", "STATE"],
  zip: ["SITUS_ZIP", "ZIP", "ZIPCODE"],
  owner: ["OWNER", "OWNER_NAME", "OWN_NAME", "NAME"],
  propertyUseCode: ["PROPERTY_USE", "USE_CODE", "DOR_UC", "CLASS_CODE", "PROPERTY_TYPE"],
  lotSizeSqft: ["LOT_SIZE_SQFT", "LOT_SQFT", "LOTSQFT", "LAND_SQFT", "LANDSQFT", "LOT_SIZE"],
  buildingSizeSqft: [
    "BUILDING_SQFT",
    "BLDG_SQFT",
    "TOTAL_BLDG_AREA",
    "LIVING_AREA",
    "BUILDINGAREA",
    "STATEDAREA",
    "AREA",
    "GROSS_AREA",
    "GROSS_LIVING_AREA",
    "TOT_LVG_AREA",
  ],
  yearBuilt: ["YEAR_BUILT", "YR_BUILT", "BUILT_YEAR", "YRBLT", "RESYRBLT", "EFF_YEAR_BUILT", "EFF_YR_BLT", "YEAR_ADDED"],
  zoning: ["ZONING", "ZONING_DESC", "ZONING_CODE"],
  askingPrice: [
    "MARKET_VALUE",
    "JUST_VALUE",
    "ASSESSED_VALUE",
    "ASSESSED_VAL",
    "TOTAL_VALUE",
    "TOTAL_MARKET",
    "LAND_VALUE",
    "LAND_MARKET",
    "ASSDVALYRC",
    "TXBLVALYRC",
  ],
  pricePerSqft: ["PRICE_PER_SQFT", "PPSF"],
  latitude: ["LATITUDE", "LAT"],
  longitude: ["LONGITUDE", "LON", "LNG"],
  saleDate: ["SALE_DATE", "LAST_SALE_DATE", "DATE_OF_SALE", "SALEDT", "SALEDATE"],
  salePrice: ["SALE_PRICE", "LAST_SALE_PRICE", "PRICE", "SALEAMOUNT"],
  saleType: ["SALE_TYPE", "QUAL_CODE", "SALE_QUALIFIER", "DEED_CODE"],
  taxYear: ["TAX_YEAR", "ROLL_YEAR", "YEAR"],
  justValue: ["JUST_VALUE", "MARKET_VALUE", "TOTAL_JUST_VALUE"],
  assessedValue: ["ASSESSED_VALUE", "ASSESSED"],
  taxableValue: ["TAXABLE_VALUE", "TAXABLE"],
  rollStage: ["ROLL_STAGE", "STAGE", "CERT_STATUS"],
  eventDate: ["EVENT_DATE", "ROLL_EVENT_DATE", "CERT_DATE", "EFFECTIVE_DATE"],
};

const DISCLAIMER_PATTERNS = ["DISCLAIMER", "NOT A CERTIFIED", "AS IS", "NO WARRANTIES"];

function normalizeHeader(value: unknown): string {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeDatasetType(datasetType?: string): MdpaDatasetType {
  const normalized = String(datasetType || "").trim().toUpperCase();
  if (normalized === "MUNICIPAL_ROLLS") return "MUNICIPAL_ROLLS";
  if (normalized === "SALES_INFO") return "SALES_INFO";
  if (normalized === "ROLL_EVENTS") return "ROLL_EVENTS";
  if (normalized === "PROPERTY_INFO") return "PROPERTY_INFO";
  if (normalized === "SPECIAL_REQUEST") return "SPECIAL_REQUEST";
  return "GENERIC";
}

function mapLibrary(datasetType: MdpaDatasetType, libraryOverride?: string) {
  if (libraryOverride?.trim()) return libraryOverride.trim();
  switch (datasetType) {
    case "MUNICIPAL_ROLLS":
      return "RE Municipal Rolls";
    case "SALES_INFO":
      return "RE Sales Info";
    case "ROLL_EVENTS":
      return "RE Roll Events";
    case "PROPERTY_INFO":
      return "RE Property Info";
    case "SPECIAL_REQUEST":
      return "RE Special Request";
    default:
      return "MDPA Generic";
  }
}

function pickField(record: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    if (record[key] && record[key].trim()) return record[key].trim();
  }
  return undefined;
}

function toNumber(value: string | undefined) {
  if (!value) return undefined;
  const normalized = value.replace(/[$,]/g, "").trim();
  if (!normalized) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (/^\d{8}$/.test(trimmed)) {
    const year = Number(trimmed.slice(0, 4));
    const month = Number(trimmed.slice(4, 6));
    const day = Number(trimmed.slice(6, 8));
    const dt = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(dt.getTime()) ? undefined : dt;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const dt = new Date(`${trimmed}T00:00:00Z`);
    return Number.isNaN(dt.getTime()) ? undefined : dt;
  }

  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed)) {
    const [m, d, yRaw] = trimmed.split("/");
    const year = yRaw.length === 2 ? Number(`20${yRaw}`) : Number(yRaw);
    const dt = new Date(Date.UTC(year, Number(m) - 1, Number(d)));
    return Number.isNaN(dt.getTime()) ? undefined : dt;
  }

  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt;
}

function normalizeRollStage(raw?: string): RollStage | undefined {
  if (!raw) return undefined;
  const value = raw.trim().toUpperCase();
  if (!value) return undefined;

  if (value === "PR" || value.includes("PRELIM")) return RollStage.PR;
  if (value === "FC" || value.includes("FIRST")) return RollStage.FC;
  if (value === "FN" || value.includes("FINAL")) return RollStage.FN;
  return undefined;
}

function hasAlias(headers: string[], aliases: string[]) {
  return aliases.some((alias) => headers.includes(alias));
}

function findHeaderRow(rows: string[][]): { index: number; headers: string[] } {
  for (let i = 0; i < rows.length; i += 1) {
    const headers = rows[i].map(normalizeHeader).filter(Boolean);
    if (!headers.length) continue;

    const hasParcel = hasAlias(headers, HEADER_MAP.parcelId);
    const hasAddress = hasAlias(headers, HEADER_MAP.address);
    const hasOwner = hasAlias(headers, HEADER_MAP.owner);

    if (hasParcel && (hasAddress || hasOwner)) {
      return { index: i, headers };
    }
  }

  throw new Error("MDPA header row not found or missing required columns");
}

function isDisclaimerRecord(record: Record<string, string>): boolean {
  const text = Object.values(record).slice(0, 4).join(" ").toUpperCase();
  return DISCLAIMER_PATTERNS.some((pattern) => text.includes(pattern));
}

function toRecord(headers: string[], row: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = String(row[index] ?? "").trim();
  });
  return record;
}

function computeCompletenessScore(input: {
  parcelId?: string;
  address?: string;
  city?: string;
  zip?: string;
  mailingAddress?: string;
  propertyUseCode?: string;
  lotSizeSqft?: number;
  buildingSizeSqft?: number;
  yearBuilt?: number;
  zoning?: string;
  askingPrice?: number;
  pricePerSqft?: number;
  latitude?: number;
  longitude?: number;
}) {
  const checks = [
    Boolean(input.parcelId),
    Boolean(input.address),
    Boolean(input.city),
    Boolean(input.zip),
    Boolean(input.mailingAddress),
    Boolean(input.propertyUseCode),
    typeof input.lotSizeSqft === "number" && input.lotSizeSqft > 0,
    typeof input.buildingSizeSqft === "number" && input.buildingSizeSqft > 0,
    typeof input.yearBuilt === "number" && input.yearBuilt >= 1700,
    Boolean(input.zoning),
    typeof input.askingPrice === "number" && input.askingPrice > 0,
    typeof input.pricePerSqft === "number" && input.pricePerSqft > 0,
    typeof input.latitude === "number",
    typeof input.longitude === "number",
  ];

  const completed = checks.filter(Boolean).length;
  return Number(((completed / checks.length) * 100).toFixed(1));
}

@Injectable()
export class MdpaIngestService {
  constructor(private readonly prisma: PrismaService) {}

  async ingest(filePath: string, maxRowsOrOptions: number | MdpaIngestOptions = 1000): Promise<IngestResult> {
    const options: MdpaIngestOptions =
      typeof maxRowsOrOptions === "number" ? { maxRows: maxRowsOrOptions } : maxRowsOrOptions;
    const maxRows = Math.max(1, options.maxRows ?? 1000);
    const datasetType = normalizeDatasetType(options.datasetType);

    if (!fs.existsSync(filePath)) {
      throw new Error("MDPA CSV file not found");
    }

    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = parseSync(raw, {
      columns: false,
      bom: true,
      relax_quotes: true,
      relax_column_count: true,
      skip_empty_lines: true,
    }) as string[][];

    if (!parsed.length) {
      throw new Error("MDPA CSV is empty");
    }

    const { index: headerRowIndex, headers } = findHeaderRow(parsed);

    if (!hasAlias(headers, HEADER_MAP.parcelId)) {
      throw new Error("MDPA CSV missing parcel identifier column");
    }

    const digest = crypto.createHash("sha256").update(raw).digest("hex");
    const fileName = filePath.split("/").pop() || "mdpa.csv";
    const snapshot = await this.prisma.mdpaDatasetSnapshot.create({
      data: {
        library: mapLibrary(datasetType, options.library),
        fileName,
        sourceUrl: options.sourceUrl,
        snapshotDate: options.snapshotDate ?? new Date(),
        sha256: digest,
        recordCount: Math.max(parsed.length - headerRowIndex - 1, 0),
      },
    });

    const result: IngestResult = {
      processed: 0,
      skipped: 0,
      createdDeals: 0,
      updatedDeals: 0,
      createdOwners: 0,
      linkedOwners: 0,
      createdSales: 0,
      createdAssessments: 0,
      createdRollEvents: 0,
      snapshotId: snapshot.id,
      datasetType,
    };

    for (let i = headerRowIndex + 1; i < parsed.length; i += 1) {
      if (result.processed >= maxRows) break;

      const row = parsed[i] || [];
      const record = toRecord(headers, row);

      if (isDisclaimerRecord(record)) {
        result.skipped += 1;
        continue;
      }

      const parcelId = pickField(record, HEADER_MAP.parcelId);
      const address = pickField(record, HEADER_MAP.address);
      const city = pickField(record, HEADER_MAP.city);
      const municipality = pickField(record, HEADER_MAP.municipality) ?? city;
      const state = pickField(record, HEADER_MAP.state) || "FL";
      const zip = pickField(record, HEADER_MAP.zip);
      const mailingAddress = pickField(record, HEADER_MAP.mailingAddress);
      const ownerName = pickField(record, HEADER_MAP.owner);
      const propertyUseCode = pickField(record, HEADER_MAP.propertyUseCode);
      const lotSizeSqft = toNumber(pickField(record, HEADER_MAP.lotSizeSqft));
      const buildingSizeSqft = toNumber(pickField(record, HEADER_MAP.buildingSizeSqft));
      const yearBuiltRaw = toNumber(pickField(record, HEADER_MAP.yearBuilt));
      const yearBuilt = typeof yearBuiltRaw === "number" ? Math.round(yearBuiltRaw) : undefined;
      const zoning = pickField(record, HEADER_MAP.zoning);
      const askingPrice = toNumber(pickField(record, HEADER_MAP.askingPrice));
      const explicitPricePerSqft = toNumber(pickField(record, HEADER_MAP.pricePerSqft));
      const fallbackPricePerSqft =
        askingPrice && buildingSizeSqft && buildingSizeSqft > 0 ? askingPrice / buildingSizeSqft : undefined;
      const pricePerSqft = explicitPricePerSqft ?? fallbackPricePerSqft;

      let latitude = toNumber(pickField(record, HEADER_MAP.latitude));
      let longitude = toNumber(pickField(record, HEADER_MAP.longitude));

      if ((latitude === undefined || longitude === undefined) && address) {
        const geocoded = await geocodeAddress(address, city, state, zip);
        if (geocoded) {
          latitude = geocoded.latitude;
          longitude = geocoded.longitude;
        }
      }

      if (!parcelId && !address) {
        result.skipped += 1;
        continue;
      }

      const name = address || (parcelId ? `Parcel ${parcelId}` : "MDPA Record");

      let deal = null;
      if (parcelId) {
        deal = await this.prisma.deal.findFirst({ where: { parcelId } });
      } else if (address) {
        deal = await this.prisma.deal.findFirst({ where: { address, city, zip } });
      }

      const score = computeScore({
        parcelId,
        address,
        city,
        zip,
        source: "mdpa",
        hasOwner: Boolean(ownerName),
      });

      const dataCompletenessScore = computeCompletenessScore({
        parcelId,
        address,
        city,
        zip,
        mailingAddress,
        propertyUseCode,
        lotSizeSqft,
        buildingSizeSqft,
        yearBuilt,
        zoning,
        askingPrice,
        pricePerSqft,
        latitude,
        longitude,
      });

      if (!deal) {
        deal = await this.prisma.deal.create({
          data: {
            name,
            parcelId,
            address,
            mailingAddress,
            city,
            municipality,
            state,
            zip,
            latitude,
            longitude,
            lotSizeSqft,
            buildingSizeSqft,
            yearBuilt,
            zoning,
            askingPrice,
            pricePerSqft,
            propertyUseCode,
            source: "mdpa",
            market: "Miami-Dade",
            score,
            dataCompletenessScore,
          },
        });
        result.createdDeals += 1;
      } else {
        deal = await this.prisma.deal.update({
          where: { id: deal.id },
          data: {
            name,
            parcelId: parcelId ?? deal.parcelId,
            address: address ?? deal.address,
            mailingAddress: mailingAddress ?? deal.mailingAddress,
            city: city ?? deal.city,
            municipality: municipality ?? deal.municipality,
            state: state ?? deal.state,
            zip: zip ?? deal.zip,
            latitude: latitude ?? deal.latitude,
            longitude: longitude ?? deal.longitude,
            lotSizeSqft: lotSizeSqft ?? deal.lotSizeSqft,
            buildingSizeSqft: buildingSizeSqft ?? deal.buildingSizeSqft,
            yearBuilt: yearBuilt ?? deal.yearBuilt,
            zoning: zoning ?? deal.zoning,
            askingPrice: askingPrice ?? deal.askingPrice,
            pricePerSqft: pricePerSqft ?? deal.pricePerSqft,
            propertyUseCode: propertyUseCode ?? deal.propertyUseCode,
            source: deal.source ?? "mdpa",
            market: deal.market ?? "Miami-Dade",
            score,
            dataCompletenessScore,
          },
        });
        result.updatedDeals += 1;
      }

      if (ownerName) {
        let owner = await this.prisma.owner.findFirst({ where: { name: ownerName } });
        if (!owner) {
          owner = await this.prisma.owner.create({ data: { name: ownerName } });
          result.createdOwners += 1;
        }

        await this.prisma.dealOwner.upsert({
          where: {
            dealId_ownerId: {
              dealId: deal.id,
              ownerId: owner.id,
            },
          },
          update: {},
          create: { dealId: deal.id, ownerId: owner.id },
        });
        result.linkedOwners += 1;
      }

      const saleDate = parseDate(pickField(record, HEADER_MAP.saleDate));
      const salePrice = toNumber(pickField(record, HEADER_MAP.salePrice));
      const saleType = pickField(record, HEADER_MAP.saleType);
      if (saleDate || typeof salePrice === "number" || saleType) {
        await this.prisma.mdpaSale.create({
          data: {
            dealId: deal.id,
            saleDate,
            salePrice,
            saleType,
            sourceSnapshotId: snapshot.id,
          },
        });
        result.createdSales += 1;
      }

      const taxYearRaw = toNumber(pickField(record, HEADER_MAP.taxYear));
      const taxYear = typeof taxYearRaw === "number" ? Math.round(taxYearRaw) : undefined;
      const justValue = toNumber(pickField(record, HEADER_MAP.justValue));
      const assessedValue = toNumber(pickField(record, HEADER_MAP.assessedValue));
      const taxableValue = toNumber(pickField(record, HEADER_MAP.taxableValue));
      const rollStage = normalizeRollStage(pickField(record, HEADER_MAP.rollStage));
      const eventDate = parseDate(pickField(record, HEADER_MAP.eventDate));

      if (taxYear && (justValue !== undefined || assessedValue !== undefined || taxableValue !== undefined)) {
        if (rollStage) {
          await this.prisma.mdpaAssessment.upsert({
            where: {
              dealId_taxYear_rollStage: {
                dealId: deal.id,
                taxYear,
                rollStage,
              },
            },
            update: {
              justValue,
              assessedValue,
              taxableValue,
              sourceSnapshotId: snapshot.id,
            },
            create: {
              dealId: deal.id,
              taxYear,
              rollStage,
              justValue,
              assessedValue,
              taxableValue,
              sourceSnapshotId: snapshot.id,
            },
          });
        } else {
          const existingAssessment = await this.prisma.mdpaAssessment.findFirst({
            where: {
              dealId: deal.id,
              taxYear,
              rollStage: null,
            },
          });
          if (existingAssessment) {
            await this.prisma.mdpaAssessment.update({
              where: { id: existingAssessment.id },
              data: {
                justValue,
                assessedValue,
                taxableValue,
                sourceSnapshotId: snapshot.id,
              },
            });
          } else {
            await this.prisma.mdpaAssessment.create({
              data: {
                dealId: deal.id,
                taxYear,
                rollStage: null,
                justValue,
                assessedValue,
                taxableValue,
                sourceSnapshotId: snapshot.id,
              },
            });
          }
        }
        result.createdAssessments += 1;
      }

      if (rollStage && (eventDate || justValue !== undefined || assessedValue !== undefined || taxableValue !== undefined)) {
        const existingRoll = await this.prisma.mdpaRollEvent.findFirst({
          where: {
            dealId: deal.id,
            stage: rollStage,
            eventDate: eventDate ?? null,
          },
        });

        if (existingRoll) {
          await this.prisma.mdpaRollEvent.update({
            where: { id: existingRoll.id },
            data: {
              justValue,
              assessedValue,
              taxableValue,
              sourceSnapshotId: snapshot.id,
            },
          });
        } else {
          await this.prisma.mdpaRollEvent.create({
            data: {
              dealId: deal.id,
              stage: rollStage,
              eventDate,
              justValue,
              assessedValue,
              taxableValue,
              sourceSnapshotId: snapshot.id,
            },
          });
        }
        result.createdRollEvents += 1;
      }

      result.processed += 1;
    }

    await this.prisma.mdpaDatasetSnapshot.update({
      where: { id: snapshot.id },
      data: {
        recordCount: result.processed,
      },
    });

    return result;
  }
}

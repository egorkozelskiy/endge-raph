/**
 * Внутренние коды сегментов для быстрого сравнения/ветвления
 */
export var SegKind;
(function (SegKind) {
    SegKind[SegKind["Key"] = 0] = "Key";
    SegKind[SegKind["Index"] = 1] = "Index";
    SegKind[SegKind["Wildcard"] = 2] = "Wildcard";
    SegKind[SegKind["Param"] = 3] = "Param";
})(SegKind || (SegKind = {}));
//# sourceMappingURL=path.types.js.map
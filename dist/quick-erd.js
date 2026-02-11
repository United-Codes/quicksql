var t = {};
t.colors = [];
t.FONT_FAMILY = 'var(--qs-diagram-font-family, "Arial")';
t.colors.TABLE_BACKGROUND = "var(--qs-diagram-table-background-color, rgb(254,246,222))";
t.colors.TABLE_BORDER = "var(--qs-diagram-table-border-color, rgba(0,0,0,.1))";
t.colors.TABLE_NAME_TEXT = "var(--qs-diagram-table-name-text-color, var(--qs-diagram-table-text-color, rgba(0,0,0,.8)))";
t.colors.TABLE_COLUMN_TEXT = "var(--qs-diagram-table-column-text-color, var(--qs-diagram-table-text-color, rgba(0,0,0,.8)))";
t.colors.TABLE_DATA_TYPE_TEXT = "var(--qs-diagram-table-data-type-text-color, var(--qs-diagram-table-text-color, rgba(0,0,0,.4)))";
t.TABLE_BORDER_RADIUS = getComputedStyle(document.documentElement).getPropertyValue("--qs-diagram-table-border-radius");
t.TABLE_BORDER_RADIUS = t.TABLE_BORDER_RADIUS ? t.TABLE_BORDER_RADIUS : 0;
t.colors.VIEW_BACKGROUND = "var(--qs-diagram-view-background-color, rgb(236,245,231))";
t.colors.VIEW_BORDER = "var(--qs-diagram-view-border-color, rgba(0,0,0,.1))";
t.colors.VIEW_NAME_TEXT = "var(--qs-diagram-view-text-color, rgb(0,0,0))";
t.colors.VIEW_COLUMN_TEXT = "var(--qs-diagram-view-column-text-color, var(--qs-diagram-view-text-color, rgba(0,0,0,.8)))";
t.colors.VIEW_DATA_TYPE_TEXT = "var(--qs-diagram-view-data-type-text-color, var(--qs-diagram-view-text-color, rgba(0,0,0,.4)))";
t.VIEW_BORDER_RADIUS = getComputedStyle(document.documentElement).getPropertyValue("--qs-diagram-view-border-radius");
t.VIEW_BORDER_RADIUS = t.VIEW_BORDER_RADIUS ? t.VIEW_BORDER_RADIUS : 4;
t.colors.LINK = "var(--qs-diagram-link-color, rgba(140,140,140,1))";
joint.shapes.quicksql = {};
joint.shapes.quicksql.Table = joint.shapes.standard.HeaderedRecord.define("quicksql.Table", {
  z: 0,
  columns: [],
  padding: { top: 25, bottom: 5, left: 0, right: 0 },
  size: { width: 60 },
  itemMinLabelWidth: 60,
  itemHeight: 16,
  itemOverflow: !0,
  attrs: {
    root: {
      magnet: !1
    },
    body: {
      // cursor: 'default',
      rx: t.TABLE_BORDER_RADIUS,
      ry: t.TABLE_BORDER_RADIUS,
      fill: t.colors.TABLE_BACKGROUND,
      stroke: t.colors.TABLE_BORDER,
      "stroke-width": 1,
      refWidth: "100%",
      refHeight: "100%"
    },
    headerLabel: {
      // cursor: 'default',
      y: -4,
      fontFamily: t.FONT_FAMILY,
      fill: t.colors.TABLE_NAME_TEXT,
      fontWeight: "bold",
      fontSize: 12,
      textWrap: {
        ellipsis: !0,
        height: 20
      }
    },
    separator: {
      // cursor: 'default',
      stroke: t.colors.TABLE_BORDER,
      strokeWidth: 1
    },
    itemBodies_0: {
      magnet: !1,
      pointerEvents: "none"
    },
    group_1: {
      pointerEvents: "none"
    },
    itemLabels: {
      fontFamily: t.FONT_FAMILY,
      fontWeight: "bold",
      fontSize: 10,
      fill: t.colors.TABLE_COLUMN_TEXT,
      pointerEvents: "none"
    },
    itemLabels_1: {
      fill: t.colors.TABLE_DATA_TYPE_TEXT,
      textAnchor: "end",
      x: "calc(0.5 * w - 20)"
    }
  }
}, {
  markup: [{
    tagName: "rect",
    selector: "body"
  }, {
    tagName: "text",
    selector: "headerLabel"
  }, {
    tagName: "path",
    selector: "separator"
  }],
  setName(n, r) {
    return this.attr(["headerLabel", "text"], n, r);
  },
  setColumns(n = []) {
    const r = [], s = [];
    n.forEach((e, a) => {
      if (!e.name)
        return;
      r.push({
        id: e.name,
        label: e.name,
        span: 2
      });
      const i = {
        id: `${e.datatype}_${a}`,
        label: e.datatype
      };
      s.push(i);
    }), this.set("items", [r, s]), this.removeInvalidLinks();
  }
});
joint.shapes.quicksql.TableView = joint.shapes.standard.RecordView.extend({
  initialize: function() {
    joint.dia.ElementView.prototype.initialize.apply(this, arguments), this.updatePath();
  },
  updatePath: function() {
    var n = "M 0 20 L " + this.model.get("size").width + " 20";
    this.model.attr("separator/d", n, {
      silent: !0
    });
  }
});
joint.shapes.quicksql.View = joint.shapes.quicksql.Table.define("quicksql.View", {
  attrs: {
    body: {
      rx: t.VIEW_BORDER_RADIUS,
      ry: t.VIEW_BORDER_RADIUS,
      fill: t.colors.VIEW_BACKGROUND,
      stroke: t.colors.VIEW_BORDER
    },
    headerLabel: {
      fontFamily: t.FONT_FAMILY,
      fill: t.colors.VIEW_NAME_TEXT
    },
    separator: {
      stroke: t.colors.TABLE_BORDER
    },
    itemLabels: {
      fill: t.colors.VIEW_COLUMN_TEXT
    },
    itemLabels_1: {
      fill: t.colors.VIEW_DATA_TYPE_TEXT
    }
  }
});
joint.shapes.quicksql.ViewView = joint.shapes.quicksql.TableView;
joint.shapes.quicksql.Relation = joint.dia.Link.extend({
  z: -1,
  defaults: {
    type: "quicksql.Relation",
    attrs: {
      ".connection": {
        stroke: t.colors.LINK,
        "stroke-width": 1,
        "stroke-dasharray": "none"
      },
      ".marker-source": {
        fill: t.colors.LINK,
        stroke: t.colors.LINK,
        d: "M 5 0 L 0 4 L 5 8 z"
      }
    },
    style: "none",
    sourceTable: "",
    targetTable: "",
    lineWidth: 1
  },
  initialize: function() {
    joint.dia.Link.prototype.initialize.apply(this, arguments), this.updateStyle(this, arguments);
  },
  updateStyle: function() {
    this.attr(".connection/stroke-dasharray", this.get("style") === "dash" ? "5 5" : "none");
  }
});
var h = {};
const g = getComputedStyle(document.querySelector(":root")).getPropertyValue("--qs-diagram-font-family") || "Arial";
h.newGuid = function() {
  function n(r) {
    var s = (Math.random().toString(16) + "000000000").substr(2, 8);
    return r ? "-" + s.substr(0, 4) + "-" + s.substr(4, 4) : s;
  }
  return n() + n(!0) + n(!0) + n();
};
h.calcWidth = function(n, r, s) {
  var e = r;
  n && (e = n.concat(".").concat(r));
  for (var a = h.getTextWidth(e, `12pt ${g}`) + 0, i = 0, o = 0, p = 0; p < s.length; p++)
    i = Math.max(i, h.getTextWidth(s[p].name, `10pt ${g}`)), o = Math.max(o, h.getTextWidth(s[p].datatype, `10pt ${g}`));
  const c = o > i ? o * 2 + 20 : i + o + 20;
  let l = Math.max(a, c);
  return Math.max(l, 230);
};
h.getTextWidth = function(n, r) {
  var s = h.getTextWidth.canvas || (h.getTextWidth.canvas = document.createElement("canvas")), e = s.getContext("2d");
  e.font = r;
  var a = e.measureText(n);
  return a.width;
};
class f {
  constructor(r, s = "#quickERD") {
    if (!s || !(typeof s == "string" && (this.element = document.querySelector(s))) && !(typeof s == "object" && (this.element = s) && typeof this.element.append == "function"))
      throw new Error("Invalid element or selector provided");
    joint.anchors.columnAnchor = function(e, a, i) {
      let o;
      const { model: p } = e, c = e.getNodeUnrotatedBBox(a), l = p.getBBox().center(), d = p.angle();
      let u = i;
      if (i instanceof Element) {
        const m = this.paper.findView(i);
        u = m ? m.getNodeBBox(i).center() : new joint.g.Point();
      }
      return u.rotate(l, d), o = u.x <= c.x + c.width ? c.leftMiddle() : c.rightMiddle(), o.rotate(l, -d);
    }, this.data = r, this.graph = new joint.dia.Graph({}, { cellNamespace: joint.shapes }), this.paper = new joint.dia.Paper({
      width: 100,
      height: 100,
      gridSize: 1,
      model: this.graph,
      highlighting: !1,
      sorting: joint.dia.Paper.sorting.APPROX,
      cellViewNamespace: joint.shapes,
      defaultRouter: { name: "metro" },
      defaultAnchor: { name: "columnAnchor" },
      defaultConnector: { name: "rounded" },
      linkPinning: !1,
      interactive: {
        vertexAdd: !1,
        linkMove: !1,
        elementMove: !0
      }
    }), this.paperScroller = new joint.ui.PaperScroller({
      autoResizePaper: !0,
      padding: 50,
      paper: this.paper
    }), this.paper.on("blank:pointerdown", (e, a, i) => {
      this.paperScroller.setCursor("grabbing"), this.paperScroller.startPanning(e, a, i);
    }), this.paper.on("blank:pointerup", () => {
      this.paperScroller.setCursor("default");
    }), this.paper.on("cell:mousewheel", (e, a, i, o, p) => {
      this.onMouseWheel(a, i, o, p);
    }), this.paper.on("blank:mousewheel", (e, a, i, o) => {
      this.onMouseWheel(e, a, i, o);
    }), new joint.ui.Snaplines({ paper: this.paper }), this.keyboard && this.keyboard.disable(), this.keyboard = new joint.ui.Keyboard(), this.keyboard.on({
      "shift+alt+a": function(e) {
        this.actualSize(), e.preventDefault(), e.stopPropagation();
      },
      "shift+alt+c": function(e) {
        this.paperScroller.centerContent(), e.preventDefault(), e.stopPropagation();
      },
      "shift+alt+f": function(e) {
        this.fitScreen(), e.preventDefault(), e.stopPropagation();
      },
      "shift+alt+p": function(e) {
        this.printDiagram(), e.preventDefault(), e.stopPropagation();
      },
      "shift+alt+s": function(e) {
        this.exportAsSVG(), e.preventDefault(), e.stopPropagation();
      }
    }, this), this.element.append(this.paperScroller.render().el), this.updateDiagram();
  }
  async updateDiagram() {
    if (this.data.items?.length) {
      let r = [];
      this.buildDiagram(r, this.data), this.graph.resetCells(r), this.autoLayout(), setTimeout(() => {
        this.paperScroller.adjustPaper(), this.actualSize();
      }, 100);
    }
  }
  buildDiagram = (r, s) => {
    let e = /* @__PURE__ */ new Map();
    s.items.forEach((a) => {
      const i = a.name.toUpperCase();
      let o = a.schema;
      o && (o = o.toUpperCase());
      const c = (a.columns || []).map((m) => ({ name: m.name.toUpperCase(), datatype: m.datatype.replace("(", " (").toUpperCase() }));
      let l = h.calcWidth(o, i, c, []), d;
      a.type && a.type === "view" ? d = this.addView(i, o, c, l) : d = this.addTable(i, o, c, l);
      const u = o ? `${o}.${i}` : i;
      e.set(u, d.id), r.push(d);
    }), s.links.forEach((a) => {
      const i = e.get(a.source.toUpperCase()), o = e.get(a.target.toUpperCase());
      i && o && r.push(this.addLink(i, o, a.source_id, a.target_id));
    });
  };
  addTable = (r, s, e, a) => {
    let i = r;
    s && (i = `${s}.${r}`);
    let o = new joint.shapes.quicksql.Table({
      id: h.newGuid(),
      size: { width: a }
    });
    return o.setName(i), o.setColumns(e), o;
  };
  addView = (r, s, e, a) => {
    let i = r;
    s && (i = `${s}.${r}`);
    let o = new joint.shapes.quicksql.View({
      id: h.newGuid(),
      size: { width: a }
    });
    return o.setName(i), o.setColumns(e), o;
  };
  addLink = (r, s, e, a) => {
    let i = "solid";
    return new joint.shapes.quicksql.Relation({
      source: { id: r, port: e.toUpperCase() },
      target: { id: s, port: a.toUpperCase() },
      style: i
    });
  };
  printDiagram = () => {
    this.paper.print();
  };
  exportAsSVG = () => {
    const r = this.graph.getBBox().inflate(50);
    this.paper.toSVG((s) => {
      var e = "QuickSqlDiagram-";
      this.saveDiagram(e, s);
    }, {
      area: r,
      convertImagesToDataUris: !0,
      preserveDimensions: this.paper.getComputedSize()
    });
  };
  saveDiagram = (r, s) => {
    function e(d) {
      return d >= 100 ? e(d % 100) : (d < 10 ? "0" : "") + d;
    }
    var a = /* @__PURE__ */ new Date(), o = {
      type: "text/plain;charset=UTF-8",
      name: r + e(a.getFullYear()) + "-" + e(a.getMonth() + 1) + "-" + e(a.getDate()) + "_" + e(a.getHours() + 1) + "-" + e(a.getMinutes()) + ".svg"
    }, p = new Blob([s], { type: o.type }), c = window.URL.createObjectURL(p), l = document.createElement("a");
    document.body.appendChild(l), l.style = "display: none", l.href = c, l.download = o.name, setTimeout(() => {
      l.click(), window.URL.revokeObjectURL(c), l.remove();
    }, 0);
  };
  zoomIn = () => {
    this.paperScroller.zoom(0.2, { max: 3 }), this.paperScroller.centerContent();
  };
  zoomOut = () => {
    this.paperScroller.zoom(-0.2, { min: 0.1 }), this.paperScroller.centerContent();
  };
  fitScreen = () => {
    this.paperScroller.zoomToFit({
      padding: 10,
      scaleGrid: 0.2,
      minScale: 0.1,
      maxScale: 3
    }), this.paperScroller.centerContent();
  };
  actualSize = () => {
    this.paperScroller.zoom(1, { absolute: !0 }), this.paperScroller.centerContent();
  };
  onMouseWheel = (r, s, e, a) => {
    r.shiftKey && (r.preventDefault(), a === -1 ? this.paperScroller.zoom(-0.2, { min: 0.1 }) : a === 1 && this.paperScroller.zoom(0.2, { max: 3 }), this.paperScroller.centerContent());
  };
  autoLayout() {
    joint.layout.DirectedGraph.layout(this.graph, {
      nodeSep: 120,
      edgeSep: 100,
      rankSep: 100
    }), this.graph.getLinks().forEach((r) => {
      r.toBack();
    });
  }
}
const E = "1.3.13", b = {
  Diagram: f,
  version: E
};
export {
  f as Diagram,
  b as default,
  E as version
};

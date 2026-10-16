/*
    KUCHO_AutoComp.jsx  —  After Effects otomatik comp dizici
    ----------------------------------------------------------
    Bölüm klasörü yapısı (örnek: F:\MainServer2\02-KUCHO-PROJECT_FILES\[01-13]_KUCHO_S5\02KU01):

        02KU01\
            01_COMPOSITING\<sahne klasörü>\*.aep      -> açılacak AE projeleri
            02_BACKGROUND\...\02KU01_S02_P03_XXX.png  -> plan klasörüne atılır
            03_SCENES_\...\<plan klasörü>\renderlar   -> plan klasörüne + comp'a (scale %52)
            06_ANIMATIC\...\02KU01_S02_P03.mov        -> plan klasörüne (+ istenirse comp'a guide layer)

    Sahne / plan numaraları dosya ve klasör adlarından otomatik okunur:
        02KU01_S02_P03  ->  2. sezon 1. bölüm, 2. sahne, 3. plan
    Klasör adlarında "S02", "SC02", "S02_P03", "P03", "PLAN03" gibi yazımlar tanınır.

    Kullanım: After Effects > File > Scripts > Run Script File... > bu dosya
    Compositing ayarları her zaman 1920x1080, 25 FPS, kare piksel olarak zorlanır.
*/

#target aftereffects

(function () {
    var SCRIPT_NAME = "KUCHO Auto Comp";
    var SETTINGS_SECTION = "KUCHO_AutoComp";
    var COMP_W = 1920, COMP_H = 1080, COMP_FPS = 25, COMP_PAR = 1;
    var DEFAULT_DUR = 5; // saniye; yeni comp için kaynaktan süre bulunamazsa

    var RE_IMG = /\.(png|jpe?g|tiff?|tga|exr|dpx|bmp)$/i;
    var RE_VID = /\.(mov|mp4|avi|mxf|m4v)$/i;
    var RE_AEP = /\.aep$/i;
    var RE_SP = /(?:^|[^A-Za-z0-9])SC?_?(\d{1,3})[_\-\s\.]*P(?:LAN)?_?(\d{1,3})(?![0-9])/i;
    var RE_S = /(?:^|[^A-Za-z0-9])SC?_?(\d{1,3})(?![0-9])/i;
    var RE_P = /(?:^|[^A-Za-z0-9])P(?:LAN)?_?(\d{1,3})(?![0-9])/i;
    var RE_EP = /(\d{2}[A-Za-z]{2,4}\d{2})(?=[_\-\s\.]|$)/;
    var RE_FRAME = /^(.*?)(\d{3,})\.([^.]+)$/;
    var RE_SKIP = /^\.|auto-save|^_backup$|__MACOSX|^Thumbs\.db$|^desktop\.ini$/i;

    // ------------------------------------------------------------------ yardımcılar

    function pad2(n) {
        var s = String(n);
        while (s.length < 2) s = "0" + s;
        return s;
    }

    function dname(f) {
        return File.decode(f.name);
    }

    function makeKey(s, p) {
        s = parseInt(s, 10);
        p = parseInt(p, 10);
        return { s: s, p: p, id: "S" + pad2(s) + "_P" + pad2(p) };
    }

    function parseKey(str, fallbackScene) {
        var m = RE_SP.exec(str);
        if (m) return makeKey(m[1], m[2]);
        if (fallbackScene !== null && fallbackScene !== undefined) {
            m = RE_P.exec(str);
            if (m) return makeKey(fallbackScene, m[1]);
        }
        return null;
    }

    function sceneFromName(str) {
        var m = RE_SP.exec(str);
        if (m) return parseInt(m[1], 10);
        m = RE_S.exec(str);
        if (m) return parseInt(m[1], 10);
        return null;
    }

    // Göreli yol parçalarından (kök -> dosya) sahne/plan anahtarını bulur.
    function keyFromSegments(segs) {
        var i, m, m2, s = null, p = null;
        for (i = segs.length - 1; i >= 0; i--) {
            m = RE_SP.exec(segs[i]);
            if (m) return makeKey(m[1], m[2]);
        }
        for (i = segs.length - 1; i >= 0; i--) {
            if (p === null) {
                m = RE_P.exec(segs[i]);
                if (m) {
                    p = m[1];
                    m2 = RE_S.exec(segs[i]);
                    if (m2) { s = m2[1]; break; }
                }
            } else {
                m = RE_S.exec(segs[i]);
                if (m) { s = m[1]; break; }
            }
        }
        return (s !== null && p !== null) ? makeKey(s, p) : null;
    }

    function epFromSegments(segs) {
        for (var i = segs.length - 1; i >= 0; i--) {
            var m = RE_EP.exec(segs[i]);
            if (m) return m[1].toUpperCase();
        }
        return null;
    }

    function sortByName(arr, getName) {
        arr.sort(function (a, b) {
            var x = getName(a).toLowerCase(), y = getName(b).toLowerCase();
            return x < y ? -1 : (x > y ? 1 : 0);
        });
        return arr;
    }

    function subFolders(folder) {
        var out = [], all = folder.getFiles();
        for (var i = 0; i < all.length; i++) {
            if (all[i] instanceof Folder && !RE_SKIP.test(dname(all[i]))) out.push(all[i]);
        }
        return sortByName(out, dname);
    }

    function stamp() {
        var d = new Date();
        return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "_" +
            pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds());
    }

    // ------------------------------------------------------------------ kaynak tarama

    function scanFiles(folder, segs, out, depth) {
        if (depth > 10) return;
        var items = folder.getFiles();
        for (var i = 0; i < items.length; i++) {
            var it = items[i], name = dname(it);
            if (RE_SKIP.test(name)) continue;
            var s2 = segs.concat([name]);
            if (it instanceof Folder) scanFiles(it, s2, out, depth + 1);
            else out.push({ file: it, name: name, segs: s2, dir: folder.fsName });
        }
    }

    // Aynı klasördeki numaralı resimleri (en az 3 haneli kare no) tek sekans olarak gruplar.
    function groupSequences(entries) {
        var groups = {}, order = [], out = [], i, e, m, gk;
        for (i = 0; i < entries.length; i++) {
            e = entries[i];
            m = RE_IMG.test(e.name) ? RE_FRAME.exec(e.name) : null;
            gk = m ? (e.dir + "|" + e.key.id + "|" + m[1].toLowerCase() + "|" + m[3].toLowerCase()) : ("single|" + i);
            if (!groups[gk]) { groups[gk] = []; order.push(gk); }
            groups[gk].push(e);
        }
        for (i = 0; i < order.length; i++) {
            var g = sortByName(groups[order[i]], function (x) { return x.name; });
            var first = g[0];
            first.seq = g.length > 1;
            first.frames = g.length;
            out.push(first);
        }
        return out;
    }

    function collectSource(folder, type, allowSeq, db, log) {
        if (!folder || !folder.exists) return;
        var raw = [], list = [], unmatched = 0, i, e;
        scanFiles(folder, [], raw, 0);
        for (i = 0; i < raw.length; i++) {
            e = raw[i];
            var ok = (type === "bg") ? RE_IMG.test(e.name) : (RE_IMG.test(e.name) || RE_VID.test(e.name));
            if (!ok) continue;
            e.key = keyFromSegments(e.segs);
            if (!e.key) { unmatched++; continue; }
            e.ep = epFromSegments(e.segs);
            e.seq = false;
            list.push(e);
        }
        if (allowSeq) list = groupSequences(list);
        for (i = 0; i < list.length; i++) {
            e = list[i];
            var d = db[e.key.id];
            if (!d) d = db[e.key.id] = { key: e.key, ep: null, bg: [], scenes: [], anim: [] };
            if (!d.ep && e.ep) d.ep = e.ep;
            d[type].push(e);
        }
        log(type.toUpperCase() + ": " + list.length + " öğe bulundu" +
            (unmatched ? " (" + unmatched + " dosyada sahne/plan okunamadı, atlandı)" : ""));
    }

    // ------------------------------------------------------------------ compositing işleri

    function findAeps(folder, depth) {
        var out = [], all = folder.getFiles(), i;
        for (i = 0; i < all.length; i++) {
            var n = dname(all[i]);
            if (RE_SKIP.test(n)) continue;
            if (all[i] instanceof File && RE_AEP.test(n)) out.push(all[i]);
        }
        if (!out.length && depth > 0) {
            var subs = subFolders(folder);
            for (i = 0; i < subs.length; i++) out = out.concat(findAeps(subs[i], depth - 1));
        }
        return out;
    }

    function newest(files) {
        var best = files[0];
        for (var i = 1; i < files.length; i++) {
            if (files[i].modified && best.modified && files[i].modified > best.modified) best = files[i];
        }
        return best;
    }

    function findJobs(compFolder) {
        var jobs = [], direct = findAeps(compFolder, 0), i, aep;
        if (direct.length) {
            aep = newest(direct);
            jobs.push({ aep: aep, label: dname(compFolder), scene: sceneFromName(dname(aep)) });
        }
        var subs = subFolders(compFolder);
        for (i = 0; i < subs.length; i++) {
            var aeps = findAeps(subs[i], 2);
            if (!aeps.length) continue;
            aep = newest(aeps);
            var sc = sceneFromName(dname(subs[i]));
            if (sc === null) sc = sceneFromName(dname(aep));
            jobs.push({ aep: aep, label: dname(subs[i]), scene: sc });
        }
        return jobs;
    }

    function backupAep(aep, log) {
        var bf = new Folder(aep.parent.fsName + "/_backup");
        if (!bf.exists) bf.create();
        var base = dname(aep).replace(RE_AEP, "");
        var target = new File(bf.fsName + "/" + base + "_" + stamp() + ".aep");
        if (aep.copy(target)) log("  yedek: " + target.fsName);
        else log("  ! yedek alınamadı: " + aep.fsName);
    }

    function buildFootageMap(proj) {
        var map = {};
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.item(i);
            if (it instanceof FootageItem && it.file) map[it.file.fsName.toLowerCase()] = it;
        }
        return map;
    }

    // Projedeki plan comp'larını ve plan klasörlerini bulur (aynı plan için en kısa ad seçilir).
    function indexProject(proj, scene) {
        var comps = {}, folders = {};
        for (var i = 1; i <= proj.numItems; i++) {
            var it = proj.item(i), k, bag = null;
            if (it instanceof CompItem) bag = comps;
            else if (it instanceof FolderItem) bag = folders;
            if (!bag) continue;
            k = parseKey(it.name, scene);
            if (!k) continue;
            if (!bag[k.id] || it.name.length < bag[k.id].name.length) bag[k.id] = it;
        }
        return { comps: comps, folders: folders };
    }

    function enforceComp(comp) {
        if (comp.width !== COMP_W) comp.width = COMP_W;
        if (comp.height !== COMP_H) comp.height = COMP_H;
        if (comp.pixelAspect !== COMP_PAR) comp.pixelAspect = COMP_PAR;
        if (comp.frameRate !== COMP_FPS) comp.frameRate = COMP_FPS;
    }

    function importEntry(e, footMap, log) {
        var k = e.file.fsName.toLowerCase();
        if (footMap[k]) return { item: footMap[k], isNew: false };
        var item;
        try {
            var io = new ImportOptions(e.file);
            if (io.canImportAs(ImportAsType.FOOTAGE)) io.importAs = ImportAsType.FOOTAGE;
            io.sequence = !!e.seq;
            if (e.seq) io.forceAlphabetical = true;
            item = app.project.importFile(io);
        } catch (err) {
            log("    ! içe aktarılamadı: " + e.name + " (" + err.toString() + ")");
            return null;
        }
        if (e.seq && item.mainSource && !item.mainSource.isStill) {
            try { item.mainSource.conformFrameRate = COMP_FPS; } catch (err2) {}
        }
        footMap[k] = item;
        return { item: item, isNew: true };
    }

    function importList(entries, folder, footMap, log) {
        var out = [];
        for (var i = 0; i < entries.length; i++) {
            var r = importEntry(entries[i], footMap, log);
            if (!r) continue;
            if (r.isNew) r.item.parentFolder = folder;
            out.push(r.item);
        }
        return out;
    }

    function hasLayerWithSource(comp, item) {
        for (var i = 1; i <= comp.numLayers; i++) {
            if (comp.layer(i).source === item) return true;
        }
        return false;
    }

    function setScale(layer, v) {
        var sc = layer.property("ADBE Transform Group").property("ADBE Scale");
        if (sc.numKeys > 0) return;
        sc.setValue(sc.value.length === 3 ? [v, v, v] : [v, v]);
    }

    function addLayer(comp, item) {
        if (hasLayerWithSource(comp, item)) return null;
        var l = comp.layers.add(item);
        if (item.mainSource && item.mainSource.isStill) {
            l.startTime = 0;
            l.outPoint = comp.duration;
        }
        return l;
    }

    function maxDuration(items) {
        var d = 0;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.mainSource && !it.mainSource.isStill && it.duration > d) d = it.duration;
        }
        return d;
    }

    function processPlan(proj, id, comp, folder, src, opts, footMap, log) {
        var i, l, created = false;
        if (!src) {
            log("  " + id + ": kaynak bulunamadı (BG/SCENES/ANIMATIC içinde yok)");
            return;
        }
        if (!comp) {
            var nm = (src.ep ? src.ep + "_" : "") + id;
            comp = proj.items.addComp(nm, COMP_W, COMP_H, COMP_PAR, DEFAULT_DUR, COMP_FPS);
            created = true;
        }
        enforceComp(comp);
        if (!folder) folder = proj.items.addFolder(comp.name);
        if (created) comp.parentFolder = folder;

        var bgItems = importList(src.bg, folder, footMap, log);
        var scItems = importList(src.scenes, folder, footMap, log);
        var anItems = importList(src.anim, folder, footMap, log);

        if (created) {
            var d = maxDuration(scItems.concat(anItems));
            if (d > 0) comp.duration = d;
        }

        // Scenes renderları: liste sırası üstten alta korunur, scale sabit.
        var nSc = 0;
        for (i = scItems.length - 1; i >= 0; i--) {
            l = addLayer(comp, scItems[i]);
            if (!l) continue;
            setScale(l, opts.scale);
            nSc++;
        }

        // BG: istenirse comp'un en altına.
        var nBg = 0;
        if (opts.bgToComp) {
            for (i = 0; i < bgItems.length; i++) {
                l = addLayer(comp, bgItems[i]);
                if (!l) continue;
                l.moveToEnd();
                setScale(l, opts.scale);
                nBg++;
            }
        }

        // Animatic: istenirse en üste guide layer (render'a girmez), comp'a sığdırılmış.
        var nAn = 0;
        if (opts.animToComp) {
            for (i = 0; i < anItems.length; i++) {
                l = addLayer(comp, anItems[i]);
                if (!l) continue;
                l.guideLayer = true;
                l.moveToBeginning();
                if (anItems[i].width && anItems[i].height) {
                    setScale(l, Math.min(COMP_W / anItems[i].width, COMP_H / anItems[i].height) * 100);
                }
                l.property("ADBE Transform Group").property("ADBE Opacity").setValue(50);
                nAn++;
            }
        }

        log("  " + comp.name + (created ? " [YENİ comp]" : "") +
            "  -> BG: " + bgItems.length + (opts.bgToComp ? " (" + nBg + " layer)" : "") +
            ", SCENES: " + scItems.length + " (" + nSc + " layer)" +
            ", ANIMATIC: " + anItems.length + (opts.animToComp ? " (" + nAn + " layer)" : ""));
    }

    function processJob(job, db, opts, log) {
        log("");
        log("=== " + job.label + "  ->  " + job.aep.fsName);
        if (opts.backup) backupAep(job.aep, log);

        app.open(job.aep);
        var proj = app.project;
        var footMap = buildFootageMap(proj);
        var idx = indexProject(proj, job.scene);

        var ids = {}, id, list = [];
        for (id in idx.comps) ids[id] = true;
        if (opts.createMissing && job.scene !== null) {
            for (id in db) if (db[id].key.s === job.scene) ids[id] = true;
        }
        for (id in ids) list.push(id);
        list.sort();

        if (!list.length) {
            log("  ! Bu projede plan comp'u bulunamadı" + (job.scene === null ? " (sahne no okunamadı)" : ""));
        }

        app.beginUndoGroup(SCRIPT_NAME);
        for (var i = 0; i < list.length; i++) {
            try {
                processPlan(proj, list[i], idx.comps[list[i]], idx.folders[list[i]], db[list[i]], opts, footMap, log);
            } catch (err) {
                log("  ! " + list[i] + " hata: " + err.toString() + (err.line ? " (satır " + err.line + ")" : ""));
            }
        }
        app.endUndoGroup();

        proj.save();
        log("  kaydedildi.");
    }

    // ------------------------------------------------------------------ klasör algılama

    function detectSubfolders(root) {
        var res = { comp: null, bg: null, scenes: null, anim: null };
        var subs = subFolders(root);
        for (var i = 0; i < subs.length; i++) {
            var n = dname(subs[i]).toUpperCase();
            if (!res.comp && (/COMP/.test(n) || /^01[_\s]/.test(n))) res.comp = subs[i];
            else if (!res.bg && (/BACKGROUND|(^|_)BG(_|$)/.test(n) || /^02[_\s]/.test(n))) res.bg = subs[i];
            else if (!res.scenes && (/SCENE/.test(n) || /^03[_\s]/.test(n))) res.scenes = subs[i];
            else if (!res.anim && (/ANIMATIC/.test(n) || /^06[_\s]/.test(n))) res.anim = subs[i];
        }
        return res;
    }

    function getSetting(k, def) {
        try {
            if (app.settings.haveSetting(SETTINGS_SECTION, k)) return app.settings.getSetting(SETTINGS_SECTION, k);
        } catch (e) {}
        return def;
    }

    function setSetting(k, v) {
        try { app.settings.saveSetting(SETTINGS_SECTION, k, String(v)); } catch (e) {}
    }

    // ------------------------------------------------------------------ arayüz

    function buildUI() {
        var w = new Window("dialog", SCRIPT_NAME);
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];

        var pRoot = w.add("panel", undefined, "Bölüm klasörü (seçince alt klasörler otomatik dolar)");
        pRoot.alignChildren = ["fill", "top"];
        var gR = pRoot.add("group");
        var eRoot = gR.add("edittext", undefined, getSetting("root", ""));
        eRoot.preferredSize.width = 520;
        var bRoot = gR.add("button", undefined, "Seç...");

        var pPaths = w.add("panel", undefined, "Klasörler (istediğini elle değiştirebilirsin)");
        pPaths.alignChildren = ["fill", "top"];

        function pathRow(label, key) {
            var g = pPaths.add("group");
            var st = g.add("statictext", undefined, label);
            st.preferredSize.width = 110;
            var e = g.add("edittext", undefined, getSetting(key, ""));
            e.preferredSize.width = 400;
            var b = g.add("button", undefined, "...");
            b.preferredSize.width = 30;
            b.onClick = function () {
                var start = new Folder(e.text);
                var f = start.exists ? start.selectDlg(label + " klasörünü seç") : Folder.selectDialog(label + " klasörünü seç");
                if (f) {
                    e.text = f.fsName;
                    if (key === "comp") scan();
                }
            };
            return e;
        }

        var eComp = pathRow("01 COMPOSITING", "comp");
        var eBg = pathRow("02 BACKGROUND", "bg");
        var eSc = pathRow("03 SCENES", "scenes");
        var eAn = pathRow("06 ANIMATIC", "anim");

        var pJobs = w.add("panel", undefined, "İşlenecek sahneler (Compositing içindeki .aep dosyaları)");
        pJobs.alignChildren = ["fill", "top"];
        var lb = pJobs.add("listbox", undefined, [], { multiselect: true });
        lb.preferredSize = [560, 160];
        var gJ = pJobs.add("group");
        var bScan = gJ.add("button", undefined, "Tara");
        var bAll = gJ.add("button", undefined, "Tümünü seç");
        var bNone = gJ.add("button", undefined, "Hiçbiri");

        var pOpt = w.add("panel", undefined, "Ayarlar");
        pOpt.alignChildren = ["left", "top"];
        var gS = pOpt.add("group");
        gS.add("statictext", undefined, "SCENES render scale (%):");
        var eScale = gS.add("edittext", undefined, getSetting("scale", "52"));
        eScale.preferredSize.width = 50;
        var cbBg = pOpt.add("checkbox", undefined, "BG png'lerini comp'a da layer olarak ekle (en alta, aynı scale ile)");
        cbBg.value = getSetting("bgToComp", "false") === "true";
        var cbAn = pOpt.add("checkbox", undefined, "Animatic'i comp'a guide layer olarak ekle (render'a girmez)");
        cbAn.value = getSetting("animToComp", "true") === "true";
        var cbNew = pOpt.add("checkbox", undefined, "Projede olmayan planlar için comp + klasör oluştur");
        cbNew.value = getSetting("createMissing", "true") === "true";
        var cbBk = pOpt.add("checkbox", undefined, "İşlemeden önce .aep yedeği al (_backup klasörüne)");
        cbBk.value = getSetting("backup", "true") === "true";
        pOpt.add("statictext", undefined, "Comp ayarları her zaman 1920x1080 / 25 FPS olarak düzeltilir.");

        var gB = w.add("group");
        gB.alignment = ["right", "top"];
        var bCancel = gB.add("button", undefined, "Kapat", { name: "cancel" });
        var bRun = gB.add("button", undefined, "Başlat", { name: "ok" });

        var jobs = [];

        function scan() {
            lb.removeAll();
            jobs = [];
            var f = new Folder(eComp.text);
            if (!eComp.text || !f.exists) return;
            jobs = findJobs(f);
            for (var i = 0; i < jobs.length; i++) {
                var it = lb.add("item", jobs[i].label + "   —   " + dname(jobs[i].aep) +
                    (jobs[i].scene === null ? "   (sahne no okunamadı)" : "   [S" + pad2(jobs[i].scene) + "]"));
                it.selected = true;
            }
        }

        function fillFromRoot(root) {
            var r = detectSubfolders(root);
            if (r.comp) eComp.text = r.comp.fsName;
            if (r.bg) eBg.text = r.bg.fsName;
            if (r.scenes) eSc.text = r.scenes.fsName;
            if (r.anim) eAn.text = r.anim.fsName;
            scan();
        }

        bRoot.onClick = function () {
            var start = new Folder(eRoot.text);
            var f = start.exists ? start.selectDlg("Bölüm klasörünü seç (örn. 02KU01)") : Folder.selectDialog("Bölüm klasörünü seç (örn. 02KU01)");
            if (f) {
                eRoot.text = f.fsName;
                fillFromRoot(f);
            }
        };
        bScan.onClick = scan;
        bAll.onClick = function () { for (var i = 0; i < lb.items.length; i++) lb.items[i].selected = true; };
        bNone.onClick = function () { for (var i = 0; i < lb.items.length; i++) lb.items[i].selected = false; };

        var result = null;
        bRun.onClick = function () {
            if (!lb.items.length) scan();
            var sel = [];
            for (var i = 0; i < lb.items.length; i++) if (lb.items[i].selected) sel.push(jobs[i]);
            if (!sel.length) { alert("İşlenecek sahne seçilmedi / Compositing klasöründe .aep bulunamadı."); return; }
            var sc = parseFloat(eScale.text);
            if (isNaN(sc) || sc <= 0) { alert("Scale değeri geçersiz."); return; }

            setSetting("root", eRoot.text);
            setSetting("comp", eComp.text);
            setSetting("bg", eBg.text);
            setSetting("scenes", eSc.text);
            setSetting("anim", eAn.text);
            setSetting("scale", sc);
            setSetting("bgToComp", cbBg.value);
            setSetting("animToComp", cbAn.value);
            setSetting("createMissing", cbNew.value);
            setSetting("backup", cbBk.value);

            result = {
                jobs: sel,
                compFolder: new Folder(eComp.text),
                bg: eBg.text ? new Folder(eBg.text) : null,
                scenes: eSc.text ? new Folder(eSc.text) : null,
                anim: eAn.text ? new Folder(eAn.text) : null,
                opts: { scale: sc, bgToComp: cbBg.value, animToComp: cbAn.value, createMissing: cbNew.value, backup: cbBk.value }
            };
            w.close(1);
        };
        bCancel.onClick = function () { w.close(0); };

        if (eComp.text) scan();
        w.show();
        return result;
    }

    function showLog(lines) {
        var w = new Window("dialog", SCRIPT_NAME + " — Sonuç");
        var e = w.add("edittext", undefined, lines.join("\n"), { multiline: true, readonly: true, scrolling: true });
        e.preferredSize = [720, 420];
        w.add("button", undefined, "Tamam", { name: "ok" });
        w.show();
    }

    // ------------------------------------------------------------------ ana akış

    function main() {
        var cfg = buildUI();
        if (!cfg) return;

        if (app.project && !app.project.close(CloseOptions.PROMPT_TO_SAVE_CHANGES)) return;

        var lines = [];
        function log(s) { lines.push(s); }
        log(SCRIPT_NAME + "  —  " + new Date().toString());

        var db = {};
        collectSource(cfg.bg, "bg", false, db, log);
        collectSource(cfg.scenes, "scenes", true, db, log);
        collectSource(cfg.anim, "anim", true, db, log);

        var pw = new Window("palette", SCRIPT_NAME);
        var st = pw.add("statictext", undefined, "Hazırlanıyor...");
        st.preferredSize.width = 460;
        var pb = pw.add("progressbar", undefined, 0, cfg.jobs.length);
        pb.preferredSize.width = 460;
        pw.show();

        app.beginSuppressDialogs();
        for (var i = 0; i < cfg.jobs.length; i++) {
            st.text = (i + 1) + "/" + cfg.jobs.length + "  " + cfg.jobs[i].label;
            pb.value = i;
            pw.update();
            try {
                processJob(cfg.jobs[i], db, cfg.opts, log);
            } catch (err) {
                log("  ! " + cfg.jobs[i].label + " işlenemedi: " + err.toString() + (err.line ? " (satır " + err.line + ")" : ""));
            }
        }
        app.endSuppressDialogs(false);
        pw.close();

        try {
            var lf = new File(cfg.compFolder.fsName + "/_AutoComp_log_" + stamp() + ".txt");
            lf.encoding = "UTF-8";
            if (lf.open("w")) { lf.write(lines.join("\r\n")); lf.close(); }
        } catch (e) {}

        showLog(lines);
    }

    main();
})();

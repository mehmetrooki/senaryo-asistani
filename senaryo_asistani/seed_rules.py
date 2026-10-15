"""İlk açılışta yüklenen başlangıç kuralları. Arayüzden düzenlenebilir/silinebilir.

match_type:
  kelime -> yalnızca tam kelime ("ha" eşleşir, "hava" eşleşmez)
  kok    -> bu kökle başlayan kelimeler ("kudur" -> kudurdu, kuduruyor, kudurmuş)
  ifade  -> birden çok kelimelik ifade, kelime sınırlarıyla ("kırmızı kabloyu kes")
"""

SEED_RULES = [
    {"pattern": "ha", "match_type": "kelime", "category": "argo", "context": "baglamsal",
     "replacements": ["", "demek", "değil mi", "yani"],
     "reason": "Bağlama bağlı: gülme ('Ha ha!'), hece ve cümle başı ünlem ('Ha, o mu?') işaretlenmez; "
               "cümle sonundaki kaba vurgu ('…mü ha?') işaretlenir."},
    {"pattern": "be", "match_type": "kelime", "category": "argo", "context": "baglamsal", "added": "1.1",
     "replacements": ["", "yani", "canım"],
     "reason": "Ekip notu: 'ya / be vb. nidalar kullanmıyoruz' — kaba sound ediyor."},
    {"pattern": "he", "match_type": "kelime", "category": "argo", "context": "baglamsal", "added": "1.1",
     "replacements": ["", "yani", "değil mi"],
     "reason": "Ekip notu: kaba/argo sound ediyor; 'yani' daha uygun."},
    {"pattern": "kudur", "match_type": "kok", "category": "argo",
     "replacements": ["çok sinirlen", "öfkelen", "huysuzlan"],
     "reason": "Hakaret/argo çağrışımı taşır."},
    {"pattern": "kırmızı kabloyu kes", "match_type": "ifade", "category": "tehlikeli davranış",
     "replacements": ["kırmızı butona bas"],
     "reason": "Kablo kesmek çocuklar için taklit edilebilir tehlikeli bir eylem."},
    {"pattern": "kabloyu kes", "match_type": "ifade", "category": "tehlikeli davranış",
     "replacements": ["butona bas", "düğmeye bas"],
     "reason": "Elektrik kablosuyla oynamayı özendirir."},
    {"pattern": "lan", "match_type": "kelime", "category": "argo",
     "replacements": ["", "dostum"], "reason": "Argo hitap."},
    {"pattern": "ulan", "match_type": "kelime", "category": "argo",
     "replacements": ["", "hey"], "reason": "Argo hitap."},
    {"pattern": "aptal", "match_type": "kok", "category": "hakaret",
     "replacements": ["şaşkın", "dalgın"], "reason": "Akran zorbalığını/hakareti normalleştirir."},
    {"pattern": "salak", "match_type": "kok", "category": "hakaret",
     "replacements": ["sakar", "şaşkın"], "reason": "Hakaret."},
    {"pattern": "gerizekalı", "match_type": "kok", "category": "hakaret",
     "replacements": ["şapşik", "şaşkın"], "reason": "Ağır hakaret."},
    {"pattern": "geber", "match_type": "kok", "category": "şiddet",
     "replacements": ["kaybol", "git buradan"], "reason": "Ölüm dileği / şiddet çağrışımı."},
    {"pattern": "seni öldürürüm", "match_type": "ifade", "category": "şiddet",
     "replacements": ["sana gününü gösteririm", "seni yakalayacağım"], "reason": "Tehdit / şiddet."},
    {"pattern": "kahretsin", "match_type": "kelime", "category": "argo",
     "replacements": ["eyvah", "hay aksi"], "reason": "Beddua içerir."},
    {"pattern": "defol", "match_type": "kok", "category": "kaba dil",
     "replacements": ["lütfen git", "biraz yalnız kalmak istiyorum"], "reason": "Kaba ve dışlayıcı ifade."},
    {"pattern": "çeneni kapa", "match_type": "ifade", "category": "kaba dil",
     "replacements": ["biraz sessiz ol", "lütfen bekle"], "reason": "Kaba susturma ifadesi."},
]

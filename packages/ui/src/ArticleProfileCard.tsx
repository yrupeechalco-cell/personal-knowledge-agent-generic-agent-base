import {
  articleProfileFromNote,
  formatProfileDate,
  type EditableArticleProfile,
  type ParsedNote
} from "@knowledge-agent/core";
import {
  CalendarDays,
  CalendarPlus,
  Check,
  FileText,
  FolderTree,
  Link2,
  PencilLine,
  Tags,
  UserRound,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocalization } from "./localization";

export interface ArticleProfileCardProps {
  note: ParsedNote;
  readOnly?: boolean;
  onSave?(profile: EditableArticleProfile): void;
}

const PROFILE_FIELDS: Array<{
  field: keyof EditableArticleProfile;
  label: string;
  placeholder: string;
  icon: ReactNode;
}> = [
  { field: "documentType", label: "文档类型", placeholder: "论文、文章、书籍、摘录、笔记…", icon: <FileText /> },
  { field: "category", label: "资料分类", placeholder: "领域 / 主题 / 项目", icon: <FolderTree /> },
  { field: "source", label: "来源", placeholder: "网址、书名、机构或采集渠道", icon: <Link2 /> },
  { field: "author", label: "作者", placeholder: "作者、机构或整理者", icon: <UserRound /> },
  { field: "created", label: "录入日期", placeholder: "YYYY-MM-DD", icon: <CalendarPlus /> },
  { field: "published", label: "发布日期", placeholder: "YYYY-MM-DD", icon: <CalendarDays /> }
];

export function ArticleProfileCard({
  note,
  readOnly = false,
  onSave
}: ArticleProfileCardProps) {
  const { runtime, t } = useLocalization();
  const profile = useMemo(() => articleProfileFromNote(note), [note]);
  const editableProfile = useMemo<EditableArticleProfile>(() => ({
    summary: profile.summary,
    documentType: profile.documentType,
    category: profile.category,
    source: profile.source,
    author: profile.author,
    created: profile.created,
    published: profile.published
  }), [profile]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditableArticleProfile>(editableProfile);
  const fallbackSummary = note.excerpt || t("尚未填写一句话简介。");
  const completedFields = Object.values(editableProfile).filter((value) => value.trim()).length;

  useEffect(() => {
    if (editing) return;
    setDraft(editableProfile);
  }, [editableProfile, editing, note.path]);

  function beginEditing() {
    setDraft({
      ...editableProfile,
      summary: editableProfile.summary || note.excerpt,
      created: editableProfile.created || formatProfileDate(new Date()),
      documentType: editableProfile.documentType || "笔记"
    });
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(editableProfile);
    setEditing(false);
  }

  function commit() {
    onSave?.(draft);
    setEditing(false);
  }

  return (
    <section className={`article-profile${editing ? " editing" : ""}`} aria-label={t("文章资料卡")}>
      <header className="article-profile-header">
        <div>
          <strong>{t("文章资料卡")}</strong>
          <span>{runtime(`${completedFields}/7 项已填写`)}</span>
        </div>
        {!readOnly && onSave ? (
          <div className="article-profile-actions">
            {editing ? (
              <>
                <button aria-label={t("取消编辑资料卡")} onClick={cancelEditing} title={t("取消")} type="button"><X /></button>
                <button aria-label={t("保存资料卡")} className="primary" onClick={commit} title={t("保存资料卡")} type="button"><Check /></button>
              </>
            ) : (
              <button aria-label={t("编辑资料卡")} onClick={beginEditing} title={t("编辑资料卡")} type="button"><PencilLine /></button>
            )}
          </div>
        ) : null}
      </header>

      {editing ? (
        <div className="article-profile-form">
          <label className="article-summary-field">
            <span>{t("一句话简介")}</span>
            <textarea
              maxLength={240}
              onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
              placeholder={t("用一句话说明这篇资料解决了什么问题或提供了什么价值")}
              rows={2}
              value={draft.summary}
            />
            <small>{draft.summary.length}/240</small>
          </label>
          <div className="article-profile-grid">
            {PROFILE_FIELDS.map((item) => (
              <label key={item.field}>
                <span>{item.icon}{t(item.label)}</span>
                <input
                  onChange={(event) => setDraft((current) => ({ ...current, [item.field]: event.target.value }))}
                  placeholder={t(item.placeholder)}
                  value={draft[item.field]}
                />
              </label>
            ))}
          </div>
        </div>
      ) : (
        <>
          <p className={profile.summary ? "article-profile-summary" : "article-profile-summary derived"}>
            {profile.summary || fallbackSummary}
          </p>
          <dl className="article-profile-values">
            {PROFILE_FIELDS.map((item) => (
              <div className={profile[item.field] ? "" : "empty"} key={item.field}>
                <dt>{item.icon}{t(item.label)}</dt>
                <dd>{profile[item.field] || t("未填写")}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <div className="article-profile-keywords">
        <span><Tags />{t("关键词")}</span>
        <div>
          {profile.keywords.length > 0
            ? profile.keywords.slice(0, 8).map((tag) => <b key={tag}>#{tag}</b>)
            : <em>{t("在下方标签体系中添加关键词")}</em>}
          {profile.keywords.length > 8 ? <small>+{profile.keywords.length - 8}</small> : null}
        </div>
      </div>
    </section>
  );
}

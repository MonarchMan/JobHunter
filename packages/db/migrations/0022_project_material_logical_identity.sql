CREATE UNIQUE INDEX `files_project_material_dossier_name_idx`
  ON `files` (
    json_extract(`properties_json`, '$.dossierId'),
    json_extract(`properties_json`, '$.fileName')
  )
  WHERE `kind` = 'project_material'
    AND json_valid(`properties_json`)
    AND json_type(`properties_json`, '$.dossierId') = 'text'
    AND json_type(`properties_json`, '$.fileName') = 'text';

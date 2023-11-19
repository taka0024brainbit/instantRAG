function setDriveRoot() {
  try {
    const folderId = PropertiesService.getScriptProperties().getProperty('folderId')
    if (!folderId) throw new Error('folderIdが入ってない')
    return DriveApp.getFolderById(folderId)
  } catch(e) {
    return DriveApp
  }
}

function searchFileInFolder(folder, fileId) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    if (files.next().getId() === fileId) {
      return true;
    }
  }

  var subfolders = folder.getFolders();
  while (subfolders.hasNext()) {
    if (searchFileInFolder(subfolders.next(), fileId)) {
      return true;
    }
  }

  return false;
}

function getFileContentByUrl(Url) {
  let ocrLanguage
  let fileId;
  try {
    ocrLanguage = PropertiesService.getScriptProperties().getProperty('ocrLanguage')
    if (!ocrLanguage) throw new Error('ocrLanguageが入ってない')    
  } catch (e) {
    ocrLanguage = 'ja'// OCRの言語設定（ここでは日本語に設定）
  }

  try {
    // URLからファイルIDを抽出
    fileId = extractFileId(Url)
    if (!fileId) {
      throw new Error('ファイルIDがURLから見つかりません。')
    }
    const folder = setDriveRoot()
    if ( folder != DriveApp && !searchFileInFolder(folder, fileId) ) {
      throw new Error('ファイルは指定されたフォルダまたはサブフォルダ内に存在しません。')
    }
  } catch (e) {
    // エラー処理
    console.log('エラー: ' + e.message + '('+ e.lineNumber +')')
    return null
  }

  try {
    // ファイルIDを使用してファイルを取得
    const file = DriveApp.getFileById(fileId)
    const mime_type = file.getMimeType()
    console.log(mime_type)

    switch (mime_type) {
      case 'application/vnd.google-apps.document':
        // ファイルの内容をテキストとして読み取る
        return DocumentApp.openById(fileId).getBody().getText()
        break
      case 'image/jpeg':
      case 'image/png':
      case 'image/gif':      
      case 'application/pdf':
        return extractText(file,{ocr: true,ocrLanguage: ocrLanguage})
        break

      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      case 'application/msword':
      case 'application/vnd.oasis.opendocument.text':
        return extractText(file,{convert: true})
        break

      case 'application/vnd.google-apps.spreadsheet':
        const spreadsheet = SpreadsheetApp.openById(fileId)
        const sheet = spreadsheet.getSheets()[0]
        return sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()
        break
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      case 'application/vnd.ms-excel':
      case 'application/x-vnd.oasis.opendocument.spreadsheet':
        return extractSheet(file)
        break
      case 'application/vnd.google-apps.presentation':
      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        return extractPresentation(fileId, mime_type)
        break
      case 'application/vnd.google-apps.script':
      case 'audio/mpeg':
      case 'video/mp4':
      case 'application/octet-stream':
        return null
        break

      default:
        return null
        break
    }
  } catch (e) {
    // エラー処理
    console.log('エラー: ' + e.message + '('+ e.lineNumber +')')
    return null
  }
}

function extractFileId(Url) {
  try {
    // URLからファイルIDを抽出する正規表現パターン
    const pattern = /\/d\/(.+?)(\/|$)/
    const matches = Url.match(pattern)
    if (matches && matches[1]) {
      return matches[1]
    }
    return null
  } catch (e) {
    // エラー処理
    console.log('エラー: ' + e.message + '('+ e.lineNumber +')')
    return null
  }
}

function extractText(file, options) {

  try {
    const blob = file.getBlob()

    // GoogleドキュメントとしてPDFを開く（OCRを使用）
    const resource = {
      title: file.getName(),
      mimeType: file.getMimeType()
    };
    
    const docFile = Drive.Files.insert(resource, blob, options)

    // ドキュメントの内容を取得
    const doc = DocumentApp.openById(docFile.id)
    const text = doc.getBody().getText()

    // 一時的に作成したGoogleドキュメントを削除
    DriveApp.getFileById(docFile.id).setTrashed(true)

    return text
  } catch (e) {
    console.log('エラー: ' + e.message + '('+ e.lineNumber +')')
    return null
  }
}

function extractSheet(file) {
  try {
    var blob = file.getBlob();
    var resource = {
      title: file.getName(),
      mimeType: MimeType.GOOGLE_SHEETS
    };

    var spreadsheet = Drive.Files.insert(resource, blob)
    var sheet = SpreadsheetApp.openById(spreadsheet.id).getSheets()[0];
    var firstRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues();
    DriveApp.getFileById(spreadsheet.id).setTrashed(true);

    return firstRow
  } catch (e) {
    console.log('エラー: ' + e.message + '('+ e.lineNumber +')')
    return null
  }
}

function extractPresentation(fileId, mime_type) {
  try {
    let slideId;
    let result = ''
    console.log('fileId' + fileId)

    if (mime_type =='application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      // ファイルを取得し、Googleスライド形式に変換
      const file = DriveApp.getFileById(fileId);
      const blob = file.getBlob();
      // パワーポイントファイルをGoogleスライドとして一時的にインポート
      const convertedSlide = Drive.Files.insert({title: file.getName(), mimeType: MimeType.GOOGLE_SLIDES}, blob);
      slideId = convertedSlide.getId();

    } else {
      slideId = fileId;
    }
    // プレゼンテーションを開く
    const presentation = SlidesApp.openById(slideId);

    // すべてのスライドを取得
    const slides = presentation.getSlides();

    slides.forEach(function(slide, index) {
      // スライド内のすべてのページ要素を取得
      var pageElements = slide.getPageElements();

      // ページ要素をループしてテキストを取得
      pageElements.forEach(function(element) {
        if ( element.getPageElementType() === SlidesApp.PageElementType.SHAPE ) {
          var shape = element.asShape();
          if (shape.getText()) {
            result += shape.getText().asString()
          }
        }
        if ( element.getPageElementType() === SlidesApp.PageElementType.IMAGE ) {
          var image = element.asImage();
          var imageUrl = image.getSourceUrl();
          if (imageUrl) {
          }
        }
      })
    })

    if (mime_type =='application/vnd.openxmlformats-officedocument.presentationml.presentation') {
      // 一時的に作成したスライドを削除
      DriveApp.getFileById(slideId).setTrashed(true);
    }

    return result
  } catch (e) {
    console.log('エラー: ' + e.message + '('+ e.lineNumber +')')
    return null
  }
}

function getFile(Url) {
  let results = {Text: getFileContentByUrl(Url)}
  return JSON.stringify(results)
}

function search(Keyword) {
  let results = []
  let count = 1
  let format;
  let root = setDriveRoot()
  
  try {
    DateFormat =  PropertiesService.getScriptProperties().getProperty('DateFormat')
    if ( !DateFormat ) {
      DateFormat = 'YYYY-MM-DD HH:mm'
    }
  } catch (e) {
    DateFormat = 'YYYY-MM-DD HH:mm'
  }

  // ファイルを検索
  const query = "(title contains '" + escapeQueryString(Keyword) + "' or fullText contains '" + escapeQueryString(Keyword) + "')" 
  const files = root.searchFiles(query);

  while (files.hasNext()) {
    var file = files.next()
    var filePath = getFullPath(file)
    results.push({
      No: count++,
      Name: file.getName(),
      Type: fileType(file.getMimeType()),
      LastUpdated: formatDate(file.getLastUpdated(), DateFormat),
      Url: file.getUrl(),
      Path: filePath,
    })
  }

  // フォルダを検索
  const folders = root.searchFolders(query)

  while (folders.hasNext()) {
    var folder = folders.next()
    var folderPath = getFullPath(folder)
    results.push({
      No: count++,
      Name: folder.getName(),
      Type: 'folder',
      LastUpdated: formatDate(folder.getLastUpdated(), DateFormat),
      Url: folder.getUrl(),     
      Path: folderPath,
    })
  }

  return JSON.stringify(results)
}

// ファイルまたはフォルダのフルパスを取得
function getFullPath(fileOrFolder) {
  let path = []
  const parents = fileOrFolder.getParents()

  while (parents.hasNext()) {
    var parent = parents.next()
    path.unshift(parent.getName())
    try {
      parents = parent.getParents()
    } catch(e) {
      break
    }
  }

  return path.join('/')
}

function formatDate(input, format) {
  // 日付のパース
  var date = new Date(input);

  // 年、月、日、時、分、秒を取得
  var year = date.getFullYear();
  var month = date.getMonth() + 1; // 月は0から始まるため、1を加える
  var day = date.getDate();
  var hours = date.getHours();
  var minutes = date.getMinutes();
  var seconds = date.getSeconds();

  // 月、日、時、分、秒が一桁の場合は先頭に0を追加
  month = month < 10 ? '0' + month : month;
  day = day < 10 ? '0' + day : day;
  hours = hours < 10 ? '0' + hours : hours;
  minutes = minutes < 10 ? '0' + minutes : minutes;
  seconds = seconds < 10 ? '0' + seconds : seconds;

  // フォーマットに従って日付を整形
  format = format.replace('YYYY', year)
                 .replace('MM', month)
                 .replace('DD', day)
                 .replace('HH', hours)
                 .replace('mm', minutes)
                 .replace('ss', seconds);

  return format;
}

function fileType(mime_type) {
    switch (mime_type) {
      case 'application/vnd.google-apps.document':
        return 'document'
        break
      case 'image/jpeg':
        return 'jpeg'
        break
      case 'image/png':
        return 'png'
        break
      case 'image/gif':      
        return 'gif'
        break
      case 'application/pdf':
        return 'pdf'
        break
      case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        return 'Word'
        break
      case 'application/msword':
        return 'Word97-2003'
        break
      case 'application/vnd.oasis.opendocument.text':
        return 'OpenDocumentTextDocument'
        break

      case 'application/vnd.google-apps.spreadsheet':
        return 'spreadsheet'
        break
      case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
        return 'excel'
        break
      case 'application/vnd.ms-excel':
        return 'excel97-2003'
        break
      case 'application/x-vnd.oasis.opendocument.spreadsheet':
        return 'OpenDocumentSpreadsheet'
        break
      case 'application/vnd.google-apps.presentation':
        return 'presentation'
        break
      case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
        return 'PowerPoint'
        break
      case 'application/vnd.google-apps.script':
        return 'GAS'
        break
      case 'audio/mpeg':
        return 'mpeg'
        break
      case 'video/mp4':
        return 'mp4'
        break
      case 'application/octet-stream':
        return null
        break
      default:
        return null
        break
    }  
}

// クエリ文字列をエスケープする関数
function escapeQueryString(query) {
  if (!query) return ''
  // シングルクォートをエスケープ
  return query.replace(/'/g, "\\'")
}

function doGet(e) {
  console.log("e: " + JSON.stringify(e))
  if (e.parameter.isTest) {
    return search(e.parameter.Keyword)
  } else {
    return ContentService.createTextOutput(search(e.parameter.Keyword)).setMimeType(ContentService.MimeType.JSON)
  }
}

function doPost(e) {
  console.log("e: " + JSON.stringify(e))
  if (e.parameter.isTest) {
    return getFile(e.parameter.Url)
  } else {
    return ContentService.createTextOutput(getFile(e.parameter.Url)).setMimeType(ContentService.MimeType.JSON)
  }
}

function doGetTest() {
  let keyword;
  keyword = 'GAS'
  const e ={parameter: {Keyword: keyword, isTest: true}}
  console.log(doGet(e))
}

function doPostTest() {
  let url
  url =''
  const e = {parameter: {Url: url, isTest: true}}
  console.log(doPost(e))
}

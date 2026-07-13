# Tarot Cards Auto-Cropper

Công cụ tự động cắt ảnh sheet (ảnh chứa nhiều lá bài Tarot ghép chung) thành từng ảnh lá bài riêng lẻ, và tự động đặt tên file theo đúng tên lá bài bằng OCR.

## Vấn đề cần giải quyết

Khi có một ảnh sheet chứa nhiều lá bài Tarot xếp theo dạng lưới (ví dụ 2 hàng x 4 cột), việc cắt thủ công từng lá bài rất tốn thời gian. Ngoài ra:
- Các lá bài không phải lúc nào cũng có kích thước đều nhau hoặc căn lưới hoàn hảo.
- Một số trang chỉ có 4-6 lá thay vì đủ 8, gây khó khăn khi cắt theo lưới cố định.
- Đặt tên file thủ công cho từng lá bài dễ sai sót và mất thời gian.

## Giải pháp

Notebook `src.ipynb` xử lý theo pipeline sau:

1. **Upload nhiều ảnh sheet cùng lúc** qua Google Colab.
2. **Tự động dò biên (boundary detection):** phân tích từng pixel để phân biệt vùng nền trắng và vùng có nội dung (lá bài), từ đó xác định chính xác toạ độ của từng lá bài trong lưới — không cần chia đều thủ công.
3. **Lọc ô trống:** với mỗi ô trong lưới, kiểm tra tỉ lệ pixel có nội dung. Nếu một trang chỉ có 4-6 lá bài thay vì đủ 8, các ô còn trống (toàn màu trắng) sẽ tự động bị bỏ qua, không tạo ra file ảnh rác.
4. **Tự động đặt tên bằng OCR:** với mỗi lá bài đã cắt, tự động xác định dòng chữ tên bài ở đáy ảnh (nằm giữa hai đường viền trang trí), dùng Tesseract OCR để đọc tên, rồi làm sạch văn bản (chỉ giữ chữ cái, viết hoa đầu từ) để đặt tên file — ví dụ `The Chariot.png`, `The Fool.png`.
5. **Kiểm tra và đóng gói:** xác minh từng ảnh đã lưu không bị lỗi trước khi nén thành file ZIP và tải về máy.

## Công nghệ sử dụng

- **Python** (chạy trên Google Colab)
- **Pillow (PIL)** — xử lý và cắt ảnh
- **NumPy** — phân tích ma trận pixel để dò biên trắng
- **Tesseract OCR / pytesseract** — nhận diện chữ tên lá bài
- **shutil** — đóng gói kết quả thành ZIP

## Cấu trúc thư mục

```
Tarot_Cards/
├── Img/        # Ảnh sheet gốc và/hoặc ảnh các lá bài đã cắt
├── pdf/        # Tài liệu liên quan (nếu có)
└── src.ipynb   # Notebook chính chứa toàn bộ code xử lý
```

## Cách sử dụng

1. Mở `src.ipynb` bằng Google Colab.
2. Chạy lần lượt các ô code từ trên xuống.
3. Khi được yêu cầu upload, chọn một hoặc nhiều ảnh sheet Tarot (có thể chọn nhiều file cùng lúc).
4. Đợi notebook xử lý: cắt ảnh, lọc ô trống, OCR đặt tên, kiểm tra lỗi.
5. File ZIP chứa toàn bộ ảnh các lá bài đã cắt và đặt tên sẽ tự động được tải về máy.

## Ghi chú

- OCR hoạt động tốt nhất với các lá bài có tên in hoa rõ ràng ở đáy ảnh. Với các lá có font chữ quá cách điệu, file sẽ được đặt tên tạm `unknown_card_x.png` để chỉnh tay sau.
- Ngưỡng dò biên trắng và ngưỡng lọc ô trống có thể tinh chỉnh trong code (`WHITE_THRESHOLD`, `CELL_CONTENT_THRESHOLD`) tuỳ theo đặc điểm ảnh đầu vào.

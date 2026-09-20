// sessionStorage.setItem("userid", '');//方便开发测试用 正式注释掉d124d088-3c2a-c3dd-edb4-1c4cfb59e74d
// sessionStorage.setItem("stu_name", "");//学生真实姓名

//固定变量
sessionStorage.setItem("login_admin_school_code", "10697");//学校code 全局变量
//sessionStorage.setItem("login_admin_school_code", "10246");//测试有数据的
sessionStorage.setItem("enrollment_type1", 1);//校招公告  企招 全局变量
sessionStorage.setItem("enrollment_type2", 2);//校招公告  公招 全局变量
sessionStorage.setItem("enrollment_type3", 3);//校招公告  事招 全局变量
sessionStorage.setItem("jobtype1", "1");//全职 全局变量
sessionStorage.setItem("jobtype2", "2");//实习 全局变量

var userid=sessionStorage.getItem('userid');//大于0 表示登录了




// 测试西北数据
// sessionStorage.setItem("school_id", "c21c07c6-381d-dd6b-7a59-59b09f01a260");//学校id 全局变量
// //sessionStorage.setItem("school_id", "5f431052-b4af-0969-a37a-955f7903c8d5");//测试有数据的
// //新闻
// sessionStorage.setItem("news1", "c27d55f8-bfc6-235f-6c85-2272a3768c54");//重要通知 全局变量
// sessionStorage.setItem("news2", "fe8790d7-6ec5-c9af-2d25-57b5387d5fdc");//新闻动态 全局变量
// sessionStorage.setItem("news3", "799d7ddb-6ac4-b6e4-42ad-5f9dbcaf9925");//公示公告 全局变量
// // 学生

// // 企业
// sessionStorage.setItem('zdy26','45d58e11-a2da-dea3-11b5-74893e2255ca')// 院校简介
//     sessionStorage.setItem('zdy26er','54049bf1-9164-f337-d266-bbe45cf6b642')// 院校简介   二级
// sessionStorage.setItem('zdy27','fc9451c7-af92-ac2a-ae3c-afd19751c506')// 中心简介
//     sessionStorage.setItem('zdy27er','bb7ef16a-1ee2-9088-a32a-4e05e612c949')// 中心简介     二级
// sessionStorage.setItem('zdy28','ef083e3d-48f8-e16d-d44a-6c5eb545d700')// 生源信息
//     sessionStorage.setItem('zdy28er','be4f2720-5593-bcaf-007a-1b6a66000737')// 生源信息     二级
// sessionStorage.setItem('zdy33','aa2012f2-394d-d562-8578-a566005dcdf0')// 预约流程
//     sessionStorage.setItem('zdy33er','3193819d-6a06-dc50-9ad9-68569254d681')// 预约流程     二级
// sessionStorage.setItem('zdy29','519a21df-52e7-1458-587a-cd2e06ccbe2c')// 就业超市

// sessionStorage.setItem('zdy30','fd69c5c1-8a02-8057-bb2b-d03e17e802f6')// 风采展示
// sessionStorage.setItem('zdy31','2edd103e-be8e-ea2f-a125-5acd0ed815b1')// 就创指导
// sessionStorage.setItem('zdy32','0fb5d5fa-521d-9911-2d52-bdfa8c045650')// 毕业手续
// sessionStorage.setItem('zdy34','71dba55b-7a83-4c83-c271-7400c5193e38')// 下载专区
// sessionStorage.setItem('zdy40','57fc9bcf-7133-d80e-0c50-1eaf4eba495a')// 就创政策

//正式数据
//学校id
sessionStorage.setItem("school_id", "1917e634-eee1-1358-537d-7e36f6f41777");//学校id 全局变量
//新闻
sessionStorage.setItem("news1", "e2e1e343-8360-4a86-2b64-abaf1d73466c");//重要通知 全局变量
sessionStorage.setItem("news2", "a73172a6-fb2c-d32a-fac2-04f2746ed031");//新闻动态 全局变量
sessionStorage.setItem("news3", "e0174834-658b-3bd6-4053-69d4314c4fc3");//公示公告 全局变量
// 学生
sessionStorage.setItem('zdy1','229a66f0-120f-20a0-3199-998b0393d863')// 中心概况
sessionStorage.setItem('zdy2','f8914613-7e05-b0d3-c9f5-0240fbba0d5d')// 中心简介
sessionStorage.setItem('zdy3','eac71c10-00c1-942b-39ec-6b377317f44c')// 部门职责
sessionStorage.setItem('zdy4','7e062605-c114-b8eb-34c5-341d5353ffff')// 部门领导
sessionStorage.setItem('zdy5','f7274b09-eadf-00be-d75b-0a088291d793')// 市场拓展部
sessionStorage.setItem('zdy6','f4ac83ee-c866-3f04-adf7-bb543ff13040')// 就业指导部
sessionStorage.setItem('zdy7','3c8c6472-26b6-488d-cb1e-f9410fa4266d')// 办公室
sessionStorage.setItem('zdy8','a1e03fae-c20c-4786-d3ad-c88c3cf1d328')// 联系我们
sessionStorage.setItem('zdy9','f1d47694-0edc-d9c1-138e-766cd494e1e7')// 就业指导
sessionStorage.setItem('zdy10','53168098-f5fc-f170-4350-541b5b46d44d')// 就业政策 
sessionStorage.setItem('zdy11','3c1b194a-0d38-251d-a4e0-b65a0c1b4856')// 生涯规划
sessionStorage.setItem('zdy12','f971255c-7f68-e216-549b-4d221bf1a6c1')// 求职技巧
sessionStorage.setItem('zdy13','5ab3e0d3-a002-1c50-92be-041660f1cd15')// 简历大全
sessionStorage.setItem('zdy14','4175788e-cfbf-1739-8159-275c3d6c8dae')// 就业指南
sessionStorage.setItem('zdy15','b639e01d-9e1a-4e83-6804-0b5a87b0b2a8')// 管理制度
sessionStorage.setItem('zdy16','c58962a9-aa1c-11c3-7b1b-eeadf669e17f')// 政策问答
sessionStorage.setItem('zdy17','66f1e180-a1ef-7344-de79-3d1a249a6eb7')// 下载专栏
sessionStorage.setItem('zdy18','b74ff5c3-0bdb-f176-c903-63940a0c84b3')// 就业协议书丢失公告
sessionStorage.setItem('zdy19','04406581-9935-b2cd-405e-7b6a5c8e133d')// 创业教育
sessionStorage.setItem('zdy20','f11e1327-d681-1c83-7e19-daa3906dbffa')// 创业政策
sessionStorage.setItem('zdy21','364d0bd5-ff03-799c-5c03-81e215cc29ed')// 创业之星
sessionStorage.setItem('zdy22','9a8ae467-de76-4a27-da95-df213315261f')// 院系交流
sessionStorage.setItem('zdy23','28bc8c96-0362-1ded-acc8-c7c90fb4f816')// 院系交流
sessionStorage.setItem('zdy24','080e3521-6f9e-dee9-e00f-fc66f02d3d41')// 培训讲座
sessionStorage.setItem('zdy25','aed08c3e-531e-d935-1c73-8c256e0ea753')// 真我风采
// 企业
sessionStorage.setItem('zdy26','baf6344e-0885-05b3-3b68-2839fbb9b169')// 院校简介
sessionStorage.setItem('zdy26er','57b5881e-0a6a-0326-6eb0-68802954b20e')// 院校简介二级
sessionStorage.setItem('zdy27','61aedbae-adc8-cf91-f197-bc62c8bd96d7')// 中心简介
sessionStorage.setItem('zdy27er','a273fe07-89d4-1ed8-6322-3d5f1bfee23f')// 中心简介二级
sessionStorage.setItem('zdy28','1e71e1f8-685a-3a7d-fefe-c9b619b8d08b')// 生源信息
sessionStorage.setItem('zdy28er','f05d3f84-1e73-bcb1-106b-d08e09434f17')// 生源信息二级
sessionStorage.setItem('zdy33','5be6da2d-67c2-81ef-9902-0f9a5416f0c2')// 预约流程
sessionStorage.setItem('zdy33er','45ca39bc-eefc-65f4-9916-d14c8ad039e6')// 预约流程     二级

sessionStorage.setItem('zdy29','f825b9df-f187-1d10-d03a-7ea7c3a8ddf7')// 就业超市

sessionStorage.setItem('zdy30','fd16f023-da08-a278-c1dd-8a5dc28eae7d')// 风采展示
sessionStorage.setItem('zdy31','53b1b738-1b02-bc14-3082-432a1964c3b3')// 就创指导
sessionStorage.setItem('zdy32','2962cbf4-9e5b-7bda-d37e-3b90d44be3e8')// 毕业手续
sessionStorage.setItem('zdy34','dc166e35-bff1-1613-ed49-8570ac494cdd')// 下载专区
sessionStorage.setItem('zdy40','9cd91d9d-a71b-9008-2eb0-4f39e8524e13')// 就创政策

